import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHealthAutoExport, parseHealthDate, parseHealthXml } from '../src/lib/healthParse.js';

test('Health Auto Export payload: blood pressure, weight in lb, heart rate, steps', () => {
  const s = parseHealthAutoExport({ data: { metrics: [
    { name: 'blood_pressure', units: 'mmHg', data: [{ date: '2026-09-10 08:12:00 +0300', systolic: 135, diastolic: 85 }] },
    { name: 'weight_body_mass', units: 'lb', data: [{ date: '2026-09-10 07:00:00 +0300', qty: 256.2 }] },
    { name: 'heart_rate', units: 'count/min', data: [{ date: '2026-09-10 09:00:00 +0300', Min: 60, Avg: 72.5, Max: 100 }] },
    { name: 'step_count', units: 'count', data: [{ date: '2026-09-10 00:00:00 +0300', qty: 6400 }] },
    { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-09-10 00:00:00 +0300', asleep: 7.1 }] },
  ] } });
  assert.deepEqual(s.map((x) => x.kind), ['blood_pressure', 'weight_body_mass', 'heart_rate', 'step_count']);
  assert.equal(s[0].ts.toISOString(), '2026-09-10T05:12:00.000Z');
  assert.equal(s[1].value.qty, 116.2);
  assert.equal(s[2].value.avg, 72.5);
});

test('date formats', () => {
  assert.equal(parseHealthDate('2026-09-10 08:12:00 +0300').toISOString(), '2026-09-10T05:12:00.000Z');
  assert.equal(parseHealthDate('2026-09-10T08:12:00+03:00').toISOString(), '2026-09-10T05:12:00.000Z');
  assert.equal(parseHealthDate('nonsense'), null);
});

test('export.xml lines: correlation blood pressure and single records', async () => {
  const lines = [
    '<Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="Omron" startDate="2025-05-01 08:00:00 +0300" endDate="2025-05-01 08:00:00 +0300">',
    ' <Record type="HKQuantityTypeIdentifierBloodPressureSystolic" unit="mmHg" startDate="2025-05-01 08:00:00 +0300" value="142"/>',
    ' <Record type="HKQuantityTypeIdentifierBloodPressureDiastolic" unit="mmHg" startDate="2025-05-01 08:00:00 +0300" value="91"/>',
    '</Correlation>',
    '<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" startDate="2025-05-01 07:30:00 +0300" value="118.4"/>',
    '<Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2025-05-01 10:00:00 +0300" value="230"/>',
    '<Record type="HKQuantityTypeIdentifierDietaryWater" unit="mL" startDate="2025-05-01 10:00:00 +0300" value="200"/>',
  ];
  const out = []; for await (const s of parseHealthXml(lines)) out.push(s);
  assert.deepEqual(out.map((x) => x.kind), ['blood_pressure', 'weight_body_mass', 'step_count']);
  assert.deepEqual(out[0].value, { systolic: 142, diastolic: 91, units: 'mmHg' });
});
