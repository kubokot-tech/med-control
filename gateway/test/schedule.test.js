import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDoseDay, nextDoseDay, describeSchedule, normalizeSchedule, isoWeekday } from '../src/lib/schedule.js';

const start = '2026-11-02'; // Monday

test('weekday helper', () => {
  assert.equal(isoWeekday('2026-11-02'), 1);
  assert.equal(isoWeekday('2026-11-08'), 7);
});

test('daily: every day from the start', () => {
  const it = { frequencyRule: 'DAILY', startDate: start };
  assert.equal(isDoseDay(it, '2026-11-01'), false, 'before the start');
  assert.equal(isDoseDay(it, '2026-11-02'), true);
  assert.equal(isDoseDay(it, '2027-03-15'), true);
  assert.equal(describeSchedule(it), 'ежедневно');
});

test('weekly on given weekdays; empty list falls back to the start weekday', () => {
  const it = { frequencyRule: 'WEEKLY', scheduleDays: [1, 4], startDate: start };
  assert.deepEqual(['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-09'].map((d) => isDoseDay(it, d)), [true, false, true, true]);
  assert.equal(nextDoseDay(it, '2026-11-03'), '2026-11-05');
  assert.equal(describeSchedule(it), 'по пн и чт');
  const bare = { frequencyRule: 'WEEKLY', scheduleDays: [], startDate: '2026-11-06' }; // Friday
  assert.deepEqual(normalizeSchedule(bare).scheduleDays, [5]);
  assert.equal(describeSchedule(bare), 'по пятницам');
  assert.equal(describeSchedule({ frequencyRule: 'WEEKLY', scheduleDays: [1, 3, 5], startDate: start }), 'по пн, ср и пт');
});

test('every N days counts from the start date', () => {
  const it = { frequencyRule: 'EVERY_N_DAYS', intervalDays: 3, startDate: start };
  assert.deepEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-08'].map((d) => isDoseDay(it, d)), [true, false, false, true, true]);
  assert.equal(nextDoseDay(it, '2026-11-06'), '2026-11-08');
  assert.equal(describeSchedule(it), 'раз в 3 дня');
  assert.equal(describeSchedule({ ...it, intervalDays: 21 }), 'раз в 21 день');
  assert.equal(describeSchedule({ ...it, intervalDays: 14 }), 'раз в 14 дней');
  assert.equal(normalizeSchedule({ ...it, intervalDays: 1 }).frequencyRule, 'DAILY', 'every 1 day is daily');
});

test('several doses a day are part of the wording: on the card, in the report and for the AI', () => {
  assert.equal(describeSchedule({ frequencyRule: 'DAILY', timesPerDay: 2 }), '2 раза в день');
  assert.equal(describeSchedule({ frequencyRule: 'DAILY', times_per_day: 5 }), '5 раз в день');
  assert.equal(describeSchedule({ frequencyRule: 'DAILY', timesPerDay: 1 }), 'ежедневно');
  assert.equal(describeSchedule({ frequencyRule: 'WEEKLY', scheduleDays: [1, 4], timesPerDay: 2 }), 'по пн и чт, 2 раза в день');
  assert.equal(describeSchedule({ frequencyRule: 'EVERY_N_DAYS', intervalDays: 3, startDate: '2026-01-01', timesPerDay: 3 }), 'раз в 3 дня, 3 раза в день');
});
