import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakLength } from '../src/lib/streak.js';

const days = (statuses) => statuses.map((status, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, status }));

test('streak: open today does not break it, a pause is skipped, a miss or skip ends it', () => {
  assert.equal(streakLength(days(['TAKEN', 'TAKEN', 'TAKEN', null])), 3);
  assert.equal(streakLength(days(['TAKEN', 'PAUSED', 'TAKEN', 'TAKEN'])), 3);
  assert.equal(streakLength(days(['TAKEN', 'MISSED', 'TAKEN', 'TAKEN'])), 2);
  assert.equal(streakLength(days(['TAKEN', 'SKIPPED', 'TAKEN', null])), 1);
  assert.equal(streakLength(days(['TAKEN', 'TAKEN', 'MISSED'])), 0);
  assert.equal(streakLength([]), 0);
});

test('streak is not capped by the display window: forty taken days count as forty', () => {
  assert.equal(streakLength(days(Array(30).fill('TAKEN').concat([null]))), 30);
  const long = Array.from({ length: 45 }, (_, i) => ({ date: `d${i}`, status: i === 0 ? 'SKIPPED' : 'TAKEN' }));
  assert.equal(streakLength(long), 44);
});

test('streak: days without a scheduled dose are skipped, not counted as misses', () => {
  assert.equal(streakLength(days(['TAKEN', 'OFF', 'OFF', 'TAKEN', 'OFF', 'OFF', 'OFF'])), 2);
  assert.equal(streakLength(days(['TAKEN', 'OFF', 'MISSED', 'OFF', 'TAKEN', 'OFF'])), 1);
});

test('streak: today with only some doses is still open; a past day with some doses ends it', () => {
  const d = (status) => ({ status });
  assert.equal(streakLength([d('TAKEN'), d('TAKEN'), d('PARTIAL')]), 2);
  assert.equal(streakLength([d('TAKEN'), d('PARTIAL'), d('TAKEN')]), 1);
});
