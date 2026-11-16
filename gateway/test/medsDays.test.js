import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOfDay, dosesPerDay } from '../src/lib/medsDays.js';

test('a day with several doses: all taken, some taken, skipped, paused', () => {
  const m = (...s) => s.map((status) => ({ status }));
  assert.equal(statusOfDay([], 2), null);
  assert.equal(statusOfDay(m('TAKEN'), 1), 'TAKEN');
  assert.equal(statusOfDay(m('TAKEN'), 2), 'PARTIAL');
  assert.equal(statusOfDay(m('TAKEN', 'SKIPPED'), 2), 'PARTIAL');
  assert.equal(statusOfDay(m('TAKEN', 'TAKEN'), 2), 'TAKEN');
  assert.equal(statusOfDay(m('SKIPPED', 'SKIPPED'), 2), 'SKIPPED');
  assert.equal(statusOfDay(m('PAUSED'), 3), 'PAUSED');
  assert.deepEqual([dosesPerDay(0), dosesPerDay('2'), dosesPerDay(40)], [1, 2, 12]);
});
