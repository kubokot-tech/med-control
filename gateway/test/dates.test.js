import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, dayRange, isValidTz } from '../src/lib/dates.js';

test('dayKey uses the given timezone, not UTC', () => {
  const t = new Date('2026-09-01T22:30:00Z'); // 01:30 next day in Moscow
  assert.equal(dayKey(t, 'UTC'), '2026-09-01');
  assert.equal(dayKey(t, 'Europe/Moscow'), '2026-09-02');
  assert.equal(dayKey('2026-03-17T20:59:59Z', 'Europe/Moscow'), '2026-03-17');
  assert.equal(dayKey('2026-03-17T21:00:00Z', 'Europe/Moscow'), '2026-03-18');
});

test('dayKey always returns YYYY-MM-DD', () => {
  assert.match(dayKey(new Date(), 'Europe/Moscow'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(dayKey(new Date('2026-01-05T00:00:00Z'), 'America/New_York'), /^2026-01-04$/);
});

test('addDays crosses month, year and DST boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addDays('2026-03-28', 3), '2026-03-31');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});

test('dayRange is inclusive', () => {
  assert.deepEqual(dayRange('2026-01-30', '2026-02-02'), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  assert.deepEqual(dayRange('2026-01-30', '2026-01-29'), []);
});

test('isValidTz', () => {
  assert.equal(isValidTz('Europe/Moscow'), true);
  assert.equal(isValidTz('Mars/Olympus'), false);
  assert.equal(isValidTz(''), false);
});
