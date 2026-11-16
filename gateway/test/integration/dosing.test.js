import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db, sched, sent, clock, weekly;
before(async () => {
  if (SKIP) return;
  db = await setupDb('dosing');
  const { createMedication } = await import('../../src/lib/medsCreate.js');
  // Monday 2 March 2026; taken on Mondays and Thursdays
  weekly = await createMedication(USER_ID, { name: 'Метотрексат', role: 'systemic', doseValue: 15, doseUnit: 'мг', remindAt: '09:00', frequencyRule: 'WEEKLY', scheduleDays: [1, 4], startDate: '2026-03-02' });
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  sent = [];
  clock = new Date('2026-03-10T11:05:00+03:00'); // Tuesday
  sched = startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3_600_000, now: () => clock, sendImpl: async (text) => { sent.push(text); }, readyImpl: () => true });
});
after(async () => { sched?.(); if (db) await db.teardown(); });

test('weekly schedule: stored, described, no reminder on other days, reminder on a dose day', { skip: SKIP }, async () => {
  const row = (await db.pool.query('select frequency_rule, schedule_days, interval_days from regimen_items where id = $1', [weekly.regimenItemId])).rows[0];
  assert.deepEqual(row, { frequency_rule: 'WEEKLY', schedule_days: [1, 4], interval_days: null });
  const { activeItems } = await import('../../src/lib/medsRecord.js');
  const item = (await activeItems(USER_ID))[0];
  assert.equal(item.frequencyRule, 'WEEKLY');
  await sched.tick();
  assert.equal(sent.length, 0, 'Tuesday is not a dose day');
  clock = new Date('2026-03-12T11:05:00+03:00'); // Thursday
  await sched.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Метотрексат 15 мг сегодня ещё не отмечен/);
});

test('weekly schedule: days without a dose are OFF, the streak counts doses, misses are only on dose days', { skip: SKIP }, async () => {
  const { recordDose } = await import('../../src/lib/medsRecord.js');
  const { streakFor } = await import('../../src/lib/medsStreak.js');
  for (const d of ['2026-03-02', '2026-03-05', '2026-03-09']) {
    await recordDose(USER_ID, { medicationId: weekly.medicationId, regimenItemId: weekly.regimenItemId, status: 'TAKEN', takenAt: `${d}T09:00:00+03:00` });
  }
  const s = await streakFor(USER_ID, { days: 14, today: '2026-03-13', tz: 'Europe/Moscow' }); // Friday; Thursday 12th was missed
  const byDay = Object.fromEntries(s.streak.map((x) => [x.date, x.status]));
  assert.equal(byDay['2026-03-03'], 'OFF');
  assert.equal(byDay['2026-03-12'], 'MISSED');
  assert.equal(s.missed, 1);
  assert.equal(s.totalDays, 4, 'Mon/Thu from 2 March to 13 March: four dose days');
  assert.equal(s.currentStreak, 0, 'the missed Thursday ends the streak');
  assert.equal(s.schedule.text, 'по пн и чт');
  const s2 = await streakFor(USER_ID, { days: 14, today: '2026-03-11', tz: 'Europe/Moscow' });
  assert.equal(s2.currentStreak, 3, 'three doses in a row, the days between do not count');
});
