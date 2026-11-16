import test from 'node:test';
import assert from 'node:assert/strict';
import { excelDay } from '../src/lib/dates.js';

test('a calendar day stays the same day in an Excel cell, whatever the server time zone', () => {
  const tz = process.env.TZ;
  try {
    for (const zone of ['Europe/Moscow', 'America/New_York', 'UTC']) {
      process.env.TZ = zone;
      assert.equal(excelDay('2026-02-23').toISOString(), '2026-02-23T00:00:00.000Z', zone);
    }
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});
