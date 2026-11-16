import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

let db; let ids;
before(async () => {
  if (SKIP) return;
  db = await setupDb('medsdoses');
  ids = await seedRegimen(db.pool);
  await db.pool.query('update regimen_items set times_per_day = 2 where id = $1', [ids.regimenItemId]);
});
after(async () => { if (db) await db.teardown(); });

const TZ = 'Europe/Moscow';

test('twice a day: each dose is its own mark; the day is whole only with both', { skip: SKIP }, async () => {
  const { recordDose, dayStatus, deleteDose } = await import('../../src/lib/medsRecord.js');
  const { streakFor } = await import('../../src/lib/medsStreak.js');
  const { listRegimens } = await import('../../src/lib/meds.js');
  const { todayKey } = await import('../../src/lib/dates.js');
  const today = todayKey(TZ);
  const base = { medicationId: ids.medicationId, regimenItemId: ids.regimenItemId, tz: TZ };

  const first = await recordDose(USER_ID, { ...base, status: 'TAKEN' });
  assert.deepEqual([first.doseNo, first.times, first.taken], [1, 2, 1]);
  let s = await streakFor(USER_ID, { tz: TZ });
  assert.deepEqual([s.today.status, s.today.taken, s.today.times], ['PARTIAL', 1, 2]);
  const item = (await listRegimens(USER_ID, { tz: TZ }))[0].items[0];
  assert.deepEqual([item.timesPerDay, item.today.taken, item.today.status], [2, 1, 'PARTIAL']);

  const second = await recordDose(USER_ID, { ...base, status: 'TAKEN' });
  assert.equal(second.doseNo, 2);
  s = await streakFor(USER_ID, { tz: TZ });
  assert.equal(s.today.status, 'TAKEN');
  const third = await recordDose(USER_ID, { ...base, status: 'TAKEN' });
  assert.equal(third.already.status, 'TAKEN', 'a third mark is refused: both doses are in');
  await assert.rejects(recordDose(USER_ID, { ...base, status: 'TAKEN', doseNo: 3 }), (e) => e.code === 'bad_dose_no');

  // undo the evening dose, mark it as skipped instead
  await deleteDose(USER_ID, second.id);
  assert.equal((await recordDose(USER_ID, { ...base, status: 'SKIPPED', doseNo: 2 })).doseNo, 2);
  const d = await dayStatus(USER_ID, ids.medicationId, today);
  assert.deepEqual([d.status, d.taken, d.marks.map((m) => m.status)], ['PARTIAL', 1, ['TAKEN', 'SKIPPED']]);
  const ev = await db.pool.query(`select title from events where user_id = $1 and type = 'MED_ADMIN' order by occurred_at`, [USER_ID]);
  assert.ok(ev.rows.some((e) => /приём 1 из 2/.test(e.title)));
});

test('calendar: TAKEN and SKIPPED mark every dose of the day, CLEAR removes all; reports count whole and partial days', { skip: SKIP }, async () => {
  const { setDays } = await import('../../src/lib/meds.js');
  const { dayStatuses } = await import('../../src/lib/medsDays.js');
  const base = { medicationId: ids.medicationId, regimenItemId: ids.regimenItemId, tz: TZ };
  assert.deepEqual(await setDays(USER_ID, { ...base, from: '2026-03-01', to: '2026-03-02', status: 'TAKEN' }), { days: 2, inserted: 4, updated: 0, deleted: 0 });
  assert.deepEqual(await setDays(USER_ID, { ...base, from: '2026-03-02', to: '2026-03-02', status: 'SKIPPED' }), { days: 1, inserted: 0, updated: 2, deleted: 0 });
  await db.pool.query(`delete from administrations where day = '2026-03-01' and dose_no = 2`);
  const rows = await dayStatuses(USER_ID, { from: '2026-03-01', to: '2026-03-02' });
  assert.deepEqual(rows.map((r) => `${r.day} ${r.status} ${r.taken}/${r.times}`), ['2026-03-01 PARTIAL 1/2', '2026-03-02 SKIPPED 0/2']);
  assert.deepEqual(await setDays(USER_ID, { ...base, from: '2026-03-01', to: '2026-03-02', status: 'CLEAR' }), { days: 2, inserted: 0, updated: 0, deleted: 3 });
});

test('history from before per-dose marks stays whole; a pause from the calendar covers every dose and stops reminders', { skip: SKIP }, async () => {
  const { readFile } = await import('node:fs/promises');
  const { streakFor } = await import('../../src/lib/medsStreak.js');
  const { setDays } = await import('../../src/lib/meds.js');
  const { dayStatuses } = await import('../../src/lib/medsDays.js');
  const { deleteDose } = await import('../../src/lib/medsRecord.js');
  // the old model: one TAKEN mark a day, made before 035 (it became dose 1)
  await db.pool.query(`insert into administrations (user_id, medication_id, regimen_item_id, taken_at, day, status, created_at)
    select $1, $2, $3, d + time '09:00', d::date, 'TAKEN', '2020-01-01' from generate_series('2026-04-01'::date, '2026-04-09'::date, interval '1 day') d`, [USER_ID, ids.medicationId, ids.regimenItemId]);
  const ev = await db.pool.query(`insert into events (user_id, type, occurred_at, title) values ($1, 'MED_ADMIN', '2026-04-05 09:00', 'старое событие') returning id`, [USER_ID]);
  assert.equal((await streakFor(USER_ID, { days: 10, tz: TZ, today: '2026-04-10' })).currentStreak, 0, 'before 036: every day looks partial');
  await db.pool.query(await readFile(new URL('../../../db/migrations/036_dose_no_legacy.sql', import.meta.url), 'utf8'));
  const s = await streakFor(USER_ID, { days: 10, tz: TZ, today: '2026-04-10' });
  assert.deepEqual([s.currentStreak, s.totalTaken, s.partial], [9, 9, 0]);
  // removing a filled-in dose does not take the day's old event with it
  const filled = await db.pool.query(`select id from administrations where day = '2026-04-05' and dose_no = 2`);
  await deleteDose(USER_ID, filled.rows[0].id);
  assert.equal((await db.pool.query('select count(*)::int c from events where id = $1', [ev.rows[0].id])).rows[0].c, 1);

  await setDays(USER_ID, { medicationId: ids.medicationId, regimenItemId: ids.regimenItemId, from: '2026-04-20', to: '2026-04-21', status: 'PAUSED', tz: TZ });
  const rows = await dayStatuses(USER_ID, { from: '2026-04-20', to: '2026-04-21' });
  assert.deepEqual(rows.map((r) => r.status), ['PAUSED', 'PAUSED']);
  const n = await db.pool.query(`select count(*)::int c from administrations where day = '2026-04-20'`);
  assert.equal(n.rows[0].c, 2, 'both doses of the day are paused');
});
