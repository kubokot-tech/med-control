import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SKIP, USER_ID, setupDb } from './helpers.js';

test('doctor PDF reports medication-specific adherence, nadir progression, missing targets and incompatible lab units', { skip: SKIP }, async (t) => {
  const db = await setupDb('doctor_report_clinical');
  const app = Fastify();
  t.after(async () => { await app.close(); await db.teardown(); });
  const tz = 'UTC';
  app.decorate('authenticate', async (req) => { req.user = { sub: USER_ID, tz }; });
  await app.register((await import('../../src/routes/report.js')).default);
  const { setUserLocale } = await import('../../src/lib/userLocale.js');
  await setUserLocale(USER_ID, { language: 'en', prefs: { region: 'US', labUnits: 'si' } });
  const { createMedication } = await import('../../src/lib/medsCreate.js');
  const { recordDose } = await import('../../src/lib/medsRecord.js');
  // Both medicines are systemic. The more recent schedule is the one named above the adherence summary.
  const second = await createMedication(USER_ID, { name: 'Fixture B', role: 'systemic', startDate: '2025-01-01' }, tz);
  const main = await createMedication(USER_ID, { name: 'Fixture A', role: 'systemic', startDate: '2025-01-02' }, tz);
  for (const day of ['2025-01-02', '2025-01-03']) {
    await recordDose(USER_ID, { ...main, status: 'TAKEN', takenAt: day + 'T10:00Z', tz });
    await recordDose(USER_ID, { ...second, status: 'SKIPPED', takenAt: day + 'T11:00Z', tz });
  }

  const { createStudy, createLesion, saveMeasurements } = await import('../../src/lib/imaging.js');
  const left = await createLesion(USER_ID, { name: 'Target L' });
  const right = await createLesion(USER_ID, { name: 'Target R' });
  const scans = [
    ['2024-11-01', 60, 40],
    ['2024-12-01', 25, 15],
    ['2025-01-02', 35, 25],
    ['2025-01-03', 35, null],
  ];
  for (const [date, leftMm, rightMm] of scans) {
    const scan = await createStudy(USER_ID, { date, modality: 'CT' }, { tz });
    const sizes = [{ lesionId: left.id, sizeMm: leftMm }];
    if (rightMm !== null) sizes.push({ lesionId: right.id, sizeMm: rightMm });
    await saveMeasurements(USER_ID, scan.id, sizes);
  }

  const { commitManual } = await import('../../src/lib/labsCommit.js');
  await commitManual(USER_ID, { date: '2025-01-02', rows: [{ key: 'HGB', value: '125', unit: 'г/л', refLow: 120, refHigh: 160 }] }, { tz });
  await commitManual(USER_ID, { date: '2025-01-03', rows: [{ key: 'HGB', value: '<9', unit: 'ммоль/л', refLow: 8, refHigh: 11 }] }, { tz });

  const response = await app.inject('/report/doctor.pdf?sections=therapy,imaging,labs&from=2025-01-02&to=2025-01-03');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const { pdfTextPages } = await import('../../src/lib/pdfText.js');
  const text = (await pdfTextPages(response.rawPayload)).pages.join(' ').replace(/\s+/g, ' ');
  assert.match(text, /Fixture A.*Doses in the period: 2 of 2 scheduled dose days \(100%\)\. Skipped on purpose: 0/);
  assert.match(text, /OTHER MEDICATION.*Fixture B/);
  assert.match(text, /11\/01\/24 2 100 — baseline/);
  assert.match(text, /12\/01\/24 2 40 -60% partial response/);
  assert.match(text, /01\/02\/25 2 60 -40% progressive disease/);
  assert.match(text, /01\/03\/25 1 — — not assessed/);
  assert.match(text, /<9 01\/03\/25 125 g\/L \(01\/02\/25\) 8–11 mmol\/L/);
});
