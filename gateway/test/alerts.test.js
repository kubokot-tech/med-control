import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labFindings, symptomFindings } from '../src/lib/alerts.js';

test('lab rules: neutrophils, platelets, ALT vs 3×ULN', () => {
  const f = labFindings([
    { key: 'NEUT#', value: 0.8, unit: '×10⁹/л', refLow: 1.8, refHigh: 7.7 },
    { key: 'NEUT#', value: 1.2, unit: '×10⁹/л' },
    { key: 'PLT', value: 60, unit: '×10⁹/л' },
    { key: 'ALT', value: 160, unit: 'Ед/л', refLow: 0, refHigh: 50 },
    { key: 'ALT', value: 120, unit: 'Ед/л', refLow: 0, refHigh: 50 },
    { key: 'HGB', value: 138, unit: 'г/л' },
    { key: null, value: 5 },
  ], { eventId: 'e1' });
  assert.deepEqual(f.map((x) => [x.key, x.severity]), [['NEUT#', 'RED'], ['NEUT#', 'YELLOW'], ['PLT', 'RED'], ['ALT', 'RED']]);
  assert.equal(f[0].dedup, 'lab:NEUT#:e1');
  assert.match(f[3].message, /трёх норм/);
});

test('units are normalised before thresholds', () => {
  assert.deepEqual(labFindings([{ key: 'HGB', value: 16.5, unit: 'г/дл' }]), []);
  assert.equal(labFindings([{ key: 'HGB', value: 7.5, unit: 'g/dL' }])[0].severity, 'RED');
  assert.equal(labFindings([{ key: 'NEUT#', value: 900, unit: 'кл/мкл' }])[0].severity, 'RED');
});

test('symptom rules: blood pressure and temperature', () => {
  assert.deepEqual(symptomFindings({ bpSys: 165, bpDia: 95 }, '2026-09-02').map((x) => [x.key, x.severity]), [['BP', 'RED']]);
  assert.deepEqual(symptomFindings({ bpSys: 142, bpDia: 88 }, '2026-09-02').map((x) => [x.key, x.severity]), [['BP', 'YELLOW']]);
  assert.deepEqual(symptomFindings({ bpSys: 120, bpDia: 80, tempC: 38.4, diarrhea: 3 }, '2026-09-02').map((x) => x.key), ['TEMP', 'DIARRHEA']);
  assert.deepEqual(symptomFindings({ bpSys: 120, bpDia: 80 }, '2026-09-02'), []);
});

test('lab rules can be passed explicitly; the most severe matching rule wins regardless of order', () => {
  const rules = [
    { key: 'GLU', severity: 'YELLOW', op: 'gt', value: 6, message: 'Глюкоза {v} {u}: выше {ref}' },
    { key: 'GLU', severity: 'RED', op: 'gt', value: 11, message: 'Глюкоза {v}: высокая' },
  ];
  const f = labFindings([{ key: 'GLU', value: 12, unit: 'ммоль/л', refHigh: 6 }, { key: 'GLU', value: 7, unit: 'ммоль/л', refHigh: 6 }], { date: '2026-09-02', rules });
  assert.deepEqual(f.map((x) => [x.severity, x.message]), [['RED', 'Глюкоза 12: высокая'], ['YELLOW', 'Глюкоза 7 ммоль/л: выше 6']]);
  assert.equal(f[0].dedup, 'lab:GLU:2026-09-02');
});

test('alert texts and the backup line use the user\'s formats (userFormat), Russian by default', async () => {
  const { createFormat } = await import('../../shared/format.js');
  const { backupLine } = await import('../src/lib/backupStatus.js');
  const rules = [{ key: 'GLU', severity: 'YELLOW', op: 'gt', value: 6, message: 'Глюкоза {v} {u}: выше {ref}' }];
  const row = [{ key: 'GLU', value: 7.25, unit: 'ммоль/л', refHigh: 6.1 }];
  assert.equal(labFindings(row, { rules })[0].message, 'Глюкоза 7,25 ммоль/л: выше 6,1');
  assert.equal(labFindings(row, { rules, format: createFormat({ prefs: { region: 'US' } }) })[0].message, 'Глюкоза 7.25 ммоль/л: выше 6.1');
  const s = { ran_at: '2026-11-03T07:05:00Z', dump_ok: true, dump_bytes: 0, uploads_bytes: 0 };
  assert.match(backupLine(s), /Бэкап 3 нояб\., 10:05:/, 'Moscow by default');
  assert.match(backupLine(s, createFormat({ timeZone: 'Asia/Yekaterinburg' })), /Бэкап 3 нояб\., 12:05:/, 'the user\'s zone');
});

test('incompatible units and uncertain bounds do not trigger numeric rules', () => {
  assert.deepEqual(labFindings([{ key: 'HGB', value: 9, unit: 'ммоль/л', refLow: 8, refHigh: 11 }]), []);
  const rule = { key: 'GLU', op: 'lt', value: 3.9, severity: 'RED', message: 'GLU {v}' };
  const input = { key: 'GLU', value: 3.9, unit: 'ммоль/л' };
  assert.equal(labFindings([{ ...input, valueText: '<3.9' }], { rules: [rule] })[0].message, 'GLU <3,9');
  assert.deepEqual(labFindings([{ ...input, valueText: '≤3.9' }], { rules: [rule] }), []);
});

test('censored measurements preserve strict bounds and have no numeric trend across units', async () => {
  const { flag, mapSeriesPoints } = await import('../src/lib/labsQuery.js');
  assert.equal(flag(3.9, 3.9, 6.1, '<3.9'), 'low');
  assert.equal(flag(3.9, 3.9, 6.1, '≤3.9'), '');
  assert.equal(flag(8, null, 8, '≤8'), 'ok');
  const rows = [
    { value_numeric: 145, unit_canonical: 'г/л' },
    { value_numeric: 9, unit_canonical: 'ммоль/л' },
    { value_numeric: 8, unit_canonical: 'ммоль/л', value_text: '<8' },
    { value_numeric: 4, unit_canonical: 'ммоль/л' },
    { value_numeric: 6, unit_canonical: 'ммоль/л' },
  ];
  assert.deepEqual(mapSeriesPoints(rows).map((p) => p.delta), [null, null, null, null, 2]);
});
