import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

let db, sched, sent, clock;
before(async () => {
  if (SKIP) return;
  db = await setupDb('scheduler');
  await seedRegimen(db.pool);
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  sent = [];
  clock = new Date('2026-03-10T11:05:00+03:00'); // Tuesday
  sched = startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3_600_000, now: () => clock, sendImpl: async (text, chat, extra) => { sent.push({ text, extra }); }, readyImpl: () => true });
});
after(async () => { sched?.(); if (db) await db.teardown(); });

test('dose reminder goes out once in the morning window and not again', { skip: SKIP }, async () => {
  await sched.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Ленватиниб 24 мг сегодня ещё не отмечен/);
  assert.match(sent[0].extra.reply_markup.inline_keyboard[0][0].callback_data, /^dose:TAKEN:2026-03-10:[0-9a-f-]{36}$/);
  await sched.tick();
  assert.equal(sent.length, 1, 'notifications table dedupes');
  const n = await db.pool.query(`select kind, ref from notifications where user_id=$1`, [USER_ID]);
  assert.equal(n.rows.length, 1);
  assert.equal(n.rows[0].kind, 'dose');
  assert.match(n.rows[0].ref, /^2026-03-10:[0-9a-f-]{36}$/);
});

test('evening reminder is skipped once the dose is recorded', { skip: SKIP }, async () => {
  const { recordDose, activeDailyItem } = await import('../../src/lib/medsRecord.js');
  const item = await activeDailyItem(USER_ID);
  await recordDose(USER_ID, { medicationId: item.medicationId, regimenItemId: item.regimenItemId, status: 'TAKEN', takenAt: '2026-03-10T12:00:00+03:00', tz: 'Europe/Moscow', source: 'test' });
  clock = new Date('2026-03-10T20:05:00+03:00');
  await sched.tick();
  assert.equal(sent.length, 1, 'no dose_again');
});

test('missing backup status raises the morning backup alert', { skip: SKIP }, async () => {
  clock = new Date('2026-03-11T09:40:00+03:00');
  await sched.tick();
  const b = sent.find((s) => /Бэкап/.test(s.text));
  assert.ok(b, 'backup_fail sent');
  assert.match(b.text, /статус не найден/);
});

test('the desktop edition has no backup service and no backup alert', { skip: SKIP }, async () => {
  const before = sent.length;
  process.env.DTC_EDITION = 'desktop';
  try {
    clock = new Date('2026-03-12T09:40:00+03:00');
    await sched.tick();
  } finally { delete process.env.DTC_EDITION; }
  assert.ok(!sent.slice(before).some((s) => /Бэкап/.test(s.text)));
});

test('sender failure releases the claim so the next tick retries', { skip: SKIP }, async () => {
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  let calls = 0;
  const s2 = startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3_600_000, now: () => new Date('2026-03-12T11:05:00+03:00'), readyImpl: () => true,
    sendImpl: async () => { calls++; if (calls === 1) throw new Error('telegram down'); } });
  await assert.rejects(s2.tick(), /telegram down/);
  await s2.tick();
  assert.equal(calls, 2);
  const n = await db.pool.query(`select count(*)::int as n from notifications where user_id=$1 and kind='dose' and ref like '2026-03-12:%'`, [USER_ID]);
  assert.equal(n.rows[0].n, 1);
  s2();
});

test('support medication reminder at its own time, systemic untouched', { skip: SKIP }, async () => {
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  const m = await db.pool.query(`insert into medications (user_id, name, role, instructions) values ($1, 'Левотироксин', 'support', 'натощак за 30 мин до завтрака') returning id`, [USER_ID]);
  const r = await db.pool.query(`insert into regimens (user_id, name, start_date) values ($1, 'Левотироксин', '2026-03-01') returning id`, [USER_ID]);
  await db.pool.query(`insert into regimen_items (regimen_id, medication_id, dose_value, dose_unit, route, frequency_rule, time_windows, prn, remind_at) values ($1, $2, 125, 'мкг', 'po', 'DAILY', '{}'::jsonb, false, '07:30')`, [r.rows[0].id, m.rows[0].id]);
  const got = [];
  const s3 = startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3_600_000, now: () => new Date('2026-03-20T07:40:00+03:00'), readyImpl: () => true, sendImpl: async (text, chat, extra) => { got.push({ text, extra }); } });
  await s3.tick();
  const sup = got.filter((g) => /Левотироксин/.test(g.text));
  assert.equal(sup.length, 1);
  assert.match(sup[0].text, /натощак за 30 мин/);
  assert.match(sup[0].extra.reply_markup.inline_keyboard[0][0].callback_data, new RegExp(`^dose:TAKEN:2026-03-20:${m.rows[0].id}$`));
  assert.equal(got.filter((g) => /Ленватиниб/.test(g.text)).length, 0, 'systemic reminder is at 11:00, not now');
  s3();
});

test('reminder times from Settings, in the user\'s own time zone; the repeat can be switched off', { skip: SKIP }, async () => {
  const { saveReminderTimes, reminderTimes } = await import('../../src/lib/reminderTimes.js');
  await assert.rejects(saveReminderTimes({ doseAt: '21:00', doseAgainAt: '20:00' }), (e) => e.code === 'repeat_before_first');
  await assert.rejects(saveReminderTimes({ doseAt: '9:5' }), (e) => e.code === 'bad_time');
  await saveReminderTimes({ doseAt: '08:30', doseAgainAt: '' });
  assert.deepEqual([reminderTimes().doseAt, reminderTimes().doseAgainAt], ['08:30', '']);
  await db.pool.query(`update users set timezone = 'Asia/Novosibirsk' where id = $1`, [USER_ID]);
  const before = sent.length;
  clock = new Date('2026-03-20T08:35:00+07:00'); // 08:35 in Novosibirsk, 04:35 in Moscow
  await sched.tick();
  assert.match(sent.slice(before).map((s) => s.text).join('\n'), /Ленватиниб 24 мг сегодня ещё не отмечен/);
  clock = new Date('2026-03-20T20:05:00+07:00');
  await sched.tick();
  assert.ok(!sent.slice(before).some((s) => /Напоминаю ещё раз/.test(s.text)), 'no repeat when it is off');
  process.env.REMIND_DOSE_AT = '10:00';
  try {
    assert.deepEqual(reminderTimes().fromEnv, ['doseAt']);
    await assert.rejects(saveReminderTimes({ doseAt: '07:00' }), (e) => e.code === 'set_in_env');
  } finally { delete process.env.REMIND_DOSE_AT; }
  await db.pool.query(`update users set timezone = 'Europe/Moscow' where id = $1`, [USER_ID]);
});

test('two systemic drugs each receive one reminder bound to that medication', { skip: SKIP }, async () => {
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  const { createMedication } = await import('../../src/lib/medsCreate.js');
  const { saveReminderTimes } = await import('../../src/lib/reminderTimes.js');
  await saveReminderTimes({ doseAt: '08:30', doseAgainAt: '' });
  const first = (await db.pool.query("select id from medications where user_id=$1 and name='Ленватиниб'", [USER_ID])).rows[0];
  const med = await createMedication(USER_ID, { name: 'Second', role: 'systemic', startDate: '2026-01-01' });
  const got = [];
  const stop = startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3_600_000,
    now: () => new Date('2026-03-24T09:00:00+07:00'), readyImpl: () => true,
    sendImpl: async (text, chat, extra) => { if (extra?.reply_markup?.inline_keyboard) got.push(extra.reply_markup.inline_keyboard[0][0].callback_data); } });
  try {
    await db.pool.query("update users set timezone='Asia/Novosibirsk' where id=$1", [USER_ID]);
    await stop.tick();
    await stop.tick();
    for (const id of [first.id, med.medicationId]) {
      assert.equal(got.filter((code) => code === 'dose:TAKEN:2026-03-24:' + id).length, 1);
    }
  } finally { stop(); }
});
