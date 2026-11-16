import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('patientcard'); });
after(async () => { if (db) await db.teardown(); });

test('patient card: saved and cleared; AI gets the age and diagnosis, never the name or the date of birth', { skip: SKIP }, async () => {
  const { savePatientCard, patientCard } = await import('../../src/lib/patientCard.js');
  const { buildPatientProfile, invalidateProfileCache } = await import('../../src/lib/patientProfile.js');
  const { buildDossierMarkdown } = await import('../../src/lib/dossierExport.js');
  await assert.rejects(savePatientCard({ birthDate: '2999-01-01' }, { today: '2026-11-02' }), (e) => e.code === 'bad_birth_date');
  const c = await savePatientCard({ name: '  Тестова   Анна ', birthDate: '1968-03-12', diagnosis: 'Пример диагноза' }, { today: '2026-11-02' });
  assert.deepEqual(c, { name: 'Тестова Анна', birthDate: '1968-03-12', diagnosis: 'Пример диагноза', callName: '', keptBy: 'self', photo: '', moments: true });
  // how the home screen addresses the patient: a short name, kept by the patient or by someone close
  await assert.rejects(savePatientCard({ keptBy: 'neighbour' }, { today: '2026-11-02' }));
  assert.deepEqual(await savePatientCard({ callName: ' мама ', keptBy: 'relative' }, { today: '2026-11-02' }), { ...c, callName: 'мама', keptBy: 'relative' });
  // a small photo: only a JPEG data URL of a sane size
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.equal((await savePatientCard({ photo }, { today: '2026-11-02' })).photo, photo);
  await assert.rejects(savePatientCard({ photo: 'https://example.com/a.jpg' }, { today: '2026-11-02' }));
  await assert.rejects(savePatientCard({ photo: `data:image/jpeg;base64,${'A'.repeat(70000)}` }, { today: '2026-11-02' }));
  invalidateProfileCache();
  const profile = await buildPatientProfile(USER_ID, { tz: 'Europe/Moscow' });
  assert.match(profile, /Пациент: возраст \d+ (год|года|лет); диагноз \(со слов пациента\): Пример диагноза\./);
  assert.ok(!/Тестова|1968|мама|base64/.test(profile), 'no name, call name, photo or birth date in what AI gets');
  const md = await buildDossierMarkdown(USER_ID, { tz: 'Europe/Moscow' });
  const text = typeof md === 'string' ? md : JSON.stringify(md);
  assert.match(text, /Пациент: возраст \d+ /);
  assert.ok(!/Тестова|1968/.test(text), 'nor in the file for AI');
  assert.equal((await savePatientCard({ moments: false }, { today: '2026-11-02' })).moments, false);
  await savePatientCard({ name: '', birthDate: '', diagnosis: '', callName: '', keptBy: 'self', photo: '', moments: true }, { today: '2026-11-02' });
  assert.deepEqual(patientCard(), { name: '', birthDate: '', diagnosis: '', callName: '', keptBy: 'self', photo: '', moments: true });
});
