import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x'; // the module imports the pool; the pure part needs none
const { momentsFrom, quietFrom, QUIET_DAYS } = await import('../src/lib/homeHuman.js');

const kinds = (r) => r.map((x) => [x.kind, x.n]);

test('therapy milestones: day 100 for three more days, the anniversary by the calendar', () => {
  assert.deepEqual(kinds(momentsFrom({ regimenStart: '2026-01-01', today: '2026-04-10' })), [['therapyDays', 100]], 'day 100 is 10 April');
  assert.deepEqual(kinds(momentsFrom({ regimenStart: '2026-01-01', today: '2026-04-13' })), [['therapyDays', 100]]);
  assert.deepEqual(momentsFrom({ regimenStart: '2026-01-01', today: '2026-04-14' }), [], 'four days later it is gone');
  assert.deepEqual(momentsFrom({ regimenStart: '2026-01-01', today: '2026-04-09' }), [], 'not before the day');
  assert.deepEqual(kinds(momentsFrom({ regimenStart: '2024-11-03', today: '2026-11-05' })), [['therapyYears', 2]]);
  assert.deepEqual(momentsFrom({ regimenStart: null, today: '2026-11-05' }), []);
  assert.deepEqual(momentsFrom({ regimenStart: '2027-01-01', today: '2026-11-05' }), [], 'a start in the future');
});

test('streak milestones: reached at 30, 100, 200, 365, then yearly; ids differ between two streaks', () => {
  const at = (currentStreak, daily = true) => momentsFrom({ currentStreak, daily, today: '2026-11-05' });
  assert.deepEqual(at(29), []);
  assert.deepEqual(kinds(at(30)), [['streakDays', 30]]);
  assert.deepEqual(kinds(at(33)), [['streakDays', 30]]);
  assert.deepEqual(at(34), []);
  assert.deepEqual(kinds(at(100, false)), [['streakDoses', 100]], 'not a daily schedule: doses, not days');
  assert.deepEqual(kinds(at(730)), [['streakDays', 730]]);
  assert.equal(at(30)[0].date, '2026-11-05');
  assert.notEqual(at(30)[0].id, momentsFrom({ currentStreak: 30, today: '2026-12-20' })[0].id);
});

test('quiet mode: two weeks after bad news unless brought back; the setting turns it on for good', () => {
  const today = '2026-11-05';
  const bad = { id: 'a', date: '2026-10-30' };
  assert.deepEqual(quietFrom({ enabled: true, badNews: null, today }), { on: false, reason: null, milestoneId: null });
  assert.deepEqual(quietFrom({ enabled: true, badNews: bad, today }), { on: true, reason: 'badNews', milestoneId: 'a' });
  assert.equal(quietFrom({ enabled: true, badNews: bad, resumedId: 'a', today }).on, false, 'brought back');
  assert.equal(quietFrom({ enabled: true, badNews: { id: 'b', date: '2026-11-04' }, resumedId: 'a', today }).on, true, 'new bad news: quiet again');
  assert.equal(quietFrom({ enabled: true, badNews: { id: 'c', date: '2026-10-01' }, today }).on, false, `older than ${QUIET_DAYS} days`);
  assert.deepEqual(quietFrom({ enabled: false, badNews: null, today }), { on: true, reason: 'setting', milestoneId: null });
});
