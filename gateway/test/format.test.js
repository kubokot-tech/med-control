import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormat, normalizePrefs, guessRegion, regionLocale, DEFAULT_PREFS } from '../../shared/format.js';

const ISO = '2026-11-02T14:05:00Z';

test('defaults reproduce the Russian formats the interface used before settings existed', () => {
  const f = createFormat({ timeZone: 'Europe/Moscow' });
  assert.equal(f.locale, 'ru-RU');
  assert.equal(f.date(ISO), new Date(ISO).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }));
  assert.equal(f.time(ISO), '17:05');
  assert.equal(f.date(ISO, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), '2 нояб., 17:05');
  assert.equal(f.number(1234.567, { maximumFractionDigits: 2 }), new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(1234.567));
  assert.equal(f.weekStart, 1);
  assert.deepEqual(f.weekdays().map(([d]) => d), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(f.weekdays()[0][1], 'пн');
  assert.equal(f.months()[10], 'ноябрь');
});

test('a calendar day never shifts with the time zone', () => {
  for (const timeZone of ['Pacific/Honolulu', 'Asia/Tokyo', 'Europe/Moscow']) {
    const f = createFormat({ timeZone });
    assert.equal(f.date('2026-11-02'), '02.11.2026');
    assert.equal(f.date('2026-11-02', { day: 'numeric', month: 'long', year: 'numeric' }), '2 ноября 2026');
  }
});

test('Russian dates drop the trailing «г.»', () => {
  const f = createFormat({ timeZone: 'UTC' });
  assert.equal(f.date('2026-11-02', { month: 'long', year: 'numeric' }), 'ноябрь 2026');
  assert.equal(f.date(ISO, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), '2 нояб. 2026, 14:05');
});

test('region sets the numeric date, the clock, separators and the first day of the week', () => {
  const us = createFormat({ prefs: { region: 'US' }, timeZone: 'UTC' });
  assert.equal(us.locale, 'en-US');
  assert.equal(us.date('2026-11-02'), '11/02/2026');
  assert.equal(us.hourCycle, 'h12');
  assert.match(us.time(ISO), /^2:05\sPM$/);
  assert.equal(us.number(1234.5, { maximumFractionDigits: 2 }), '1,234.5');
  assert.equal(us.weekStart, 7);
  assert.equal(us.weekdays()[0][0], 7);
  const gb = createFormat({ prefs: { region: 'GB' }, timeZone: 'UTC' });
  assert.equal(gb.date('2026-11-02'), '02/11/2026');
  assert.equal(gb.weekStart, 1);
});

test('each regional default can be overridden', () => {
  const f = createFormat({ prefs: { region: 'RU', dateFormat: 'mdy', hourCycle: 'h12', weekStart: 'sun' }, timeZone: 'UTC' });
  assert.equal(f.date('2026-11-02'), '11/02/2026');
  assert.equal(createFormat({ prefs: { dateFormat: 'ymd' } }).date('2026-11-02'), '2026-11-02');
  assert.equal(createFormat({ prefs: { region: 'US', dateFormat: 'dmy' } }).date('2026-11-02'), '02.11.2026');
  assert.equal(f.hourCycle, 'h12');
  assert.equal(f.weekdays()[0][1], 'вс');
  assert.equal(createFormat({ prefs: { region: 'US', hourCycle: 'h23' }, timeZone: 'UTC' }).time(ISO), '14:05');
});

test('numbers typed as text get the region decimal separator', () => {
  const ru = createFormat(); const us = createFormat({ prefs: { region: 'US' } });
  assert.equal(ru.numText('5.9'), '5,9');
  assert.equal(ru.numText('<0.1'), '<0,1');
  assert.equal(us.numText('5,9'), '5.9');
  assert.equal(ru.numText('отрицательно'), 'отрицательно');
  assert.equal(ru.numText(''), '');
  assert.equal(ru.numText(null), null);
});

test('wall-clock times follow the 12/24 hour setting', () => {
  assert.equal(createFormat().clock('09:30'), '09:30');
  assert.match(createFormat({ prefs: { hourCycle: 'h12' } }).clock('14:30'), /^2:30\sPM$/);
  assert.equal(createFormat().clock('утром'), 'утром');
  assert.equal(createFormat().clock(null), '');
});

test('empty and broken values format to an empty string', () => {
  const f = createFormat();
  assert.equal(f.date(null), '');
  assert.equal(f.date(''), '');
  assert.equal(f.date('not a date'), '');
  assert.equal(f.number(null), '');
  assert.equal(f.number('x'), '');
});

test('settings are normalized and the region guessed from the browser', () => {
  assert.deepEqual(normalizePrefs(null), { ...DEFAULT_PREFS });
  assert.deepEqual(normalizePrefs({ region: 'us', dateFormat: 'bogus', hourCycle: 'h12', extra: 1 }), { region: 'US', dateFormat: 'auto', hourCycle: 'h12', weekStart: 'auto', labUnits: 'auto', temperature: 'auto', weight: 'auto' });
  assert.equal(normalizePrefs({ region: 'XX' }).region, 'RU');
  assert.equal(guessRegion('en-GB'), 'GB');
  assert.equal(guessRegion('ru'), 'RU');
  assert.equal(guessRegion('de'), 'DE');
  assert.equal(guessRegion('zz-invalid-!!'), 'RU');
  assert.equal(regionLocale('DE'), 'de-DE');
});

test('units follow the region unless chosen: US lab units, °F and pounds in the US', () => {
  const ru = createFormat();
  assert.deepEqual([ru.labUnits, ru.temperature, ru.weight], ['si', 'c', 'kg']);
  const us = createFormat({ prefs: { region: 'US' } });
  assert.deepEqual([us.labUnits, us.temperature, us.weight], ['conventional', 'f', 'lb']);
  const mixed = createFormat({ prefs: { region: 'US', labUnits: 'si', temperature: 'c' } });
  assert.deepEqual([mixed.labUnits, mixed.temperature, mixed.weight], ['si', 'c', 'lb']);
});

test('hour(): the hour on the user clock, 0–23 even with a 12-hour display', () => {
  const at = new Date('2026-11-03T06:30:00Z');
  assert.equal(createFormat({ timeZone: 'Europe/Moscow' }).hour(at), 9);
  assert.equal(createFormat({ timeZone: 'America/New_York', prefs: { region: 'US' } }).hour(at), 1);
  assert.equal(createFormat({ timeZone: 'Asia/Tokyo' }).hour(at), 15);
  assert.equal(createFormat().hour('not a date'), null);
});
