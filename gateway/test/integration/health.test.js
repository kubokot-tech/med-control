import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('health'); });
after(async () => { if (db) await db.teardown(); });

test('imported samples land in the diary per day, raise the BP alert, and are idempotent', { skip: SKIP }, async () => {
  const { parseHealthAutoExport, importSamples, healthStatus } = await import('../../src/lib/healthImport.js');
  const { todayKey } = await import('../../src/lib/dates.js');
  const D = todayKey('Europe/Moscow'); // alerts are raised only for recent days
  const samples = parseHealthAutoExport({ data: { metrics: [
    { name: 'blood_pressure', units: 'mmHg', data: [{ date: `${D} 08:00:00 +0300`, systolic: 150, diastolic: 95 }, { date: `${D} 20:00:00 +0300`, systolic: 138, diastolic: 88 }] },
    { name: 'weight_body_mass', units: 'kg', data: [{ date: `${D} 07:00:00 +0300`, qty: 116.25 }] },
    { name: 'step_count', units: 'count', data: [{ date: `${D} 09:00:00 +0300`, qty: 3000 }, { date: `${D} 18:00:00 +0300`, qty: 2500 }] },
    { name: 'resting_heart_rate', units: 'count/min', data: [{ date: `${D} 00:00:00 +0300`, qty: 68 }] },
  ] } });
  const s1 = await importSamples(USER_ID, samples);
  assert.equal(s1.inserted, 6);
  assert.equal(s1.days, 1);
  const e = await db.pool.query('select bp_sys, bp_dia, weight_kg::float as w, steps, pulse from symptom_entries where user_id=$1', [USER_ID]);
  assert.deepEqual(e.rows, [{ bp_sys: 150, bp_dia: 95, w: 116.3, steps: 5500, pulse: 68 }], 'highest BP of the day, last weight, steps summed');
  const alerts = await db.pool.query(`select context->>'key' as key from alerts where user_id=$1`, [USER_ID]);
  assert.deepEqual(alerts.rows.map((a) => a.key), ['BP'], '150/95 raises the ≥140/90 alert');
  const s2 = await importSamples(USER_ID, samples);
  assert.equal(s2.inserted, 0);
  const st = await healthStatus(USER_ID);
  assert.equal(st.kinds.length, 4);
});

test('historic days raise no alerts, device BP never lowers a manual reading, pulse alone creates no day, aggregates update', { skip: SKIP }, async () => {
  const { parseHealthAutoExport, importSamples } = await import('../../src/lib/healthImport.js');
  const { saveSymptoms } = await import('../../src/lib/symptoms.js');
  const before = (await db.pool.query(`select count(*)::int as n from alerts where user_id=$1`, [USER_ID])).rows[0].n;
  await importSamples(USER_ID, parseHealthAutoExport({ data: { metrics: [{ name: 'blood_pressure', units: 'mmHg', data: [{ date: '2025-01-05 08:00:00 +0300', systolic: 170, diastolic: 105 }] }] } }));
  const after = (await db.pool.query(`select count(*)::int as n from alerts where user_id=$1`, [USER_ID])).rows[0].n;
  assert.equal(after, before, 'a year-old 170/105 does not raise an alert');
  await importSamples(USER_ID, parseHealthAutoExport({ data: { metrics: [{ name: 'heart_rate', units: 'count/min', data: [{ date: '2025-02-01 09:00:00 +0300', Avg: 70 }] }] } }));
  assert.equal((await db.pool.query(`select count(*)::int as n from symptom_entries where user_id=$1 and date='2025-02-01'`, [USER_ID])).rows[0].n, 0);
  await saveSymptoms(USER_ID, '2025-03-01', { bpSys: 160, bpDia: 100 });
  await importSamples(USER_ID, parseHealthAutoExport({ data: { metrics: [{ name: 'blood_pressure', units: 'mmHg', data: [{ date: '2025-03-01 20:00:00 +0300', systolic: 130, diastolic: 80 }] }] } }));
  assert.equal((await db.pool.query(`select bp_sys from symptom_entries where user_id=$1 and date='2025-03-01'`, [USER_ID])).rows[0].bp_sys, 160);
  const steps = (q) => ({ data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: '2025-03-01 00:00:00 +0300', qty: q }] }] } });
  await importSamples(USER_ID, parseHealthAutoExport(steps(1000)));
  await importSamples(USER_ID, parseHealthAutoExport(steps(5200)));
  assert.equal((await db.pool.query(`select steps from symptom_entries where user_id=$1 and date='2025-03-01'`, [USER_ID])).rows[0].steps, 5200, 'daily aggregate updated');
});
