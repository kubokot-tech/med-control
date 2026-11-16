import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

let db;
let ids;
before(async () => { if (!SKIP) { db = await setupDb('medscore'); ids = await seedRegimen(db.pool); } });
after(async () => { if (db) await db.teardown(); });

const TZ = 'Europe/Moscow';
const code = (re) => (e) => e.name === 'CoreError' && re.test(e.code);

test('listRegimens: the seeded daily regimen with its schedule text and today flag', { skip: SKIP }, async () => {
  const { listRegimens } = await import('../../src/lib/meds.js');
  const [r] = await listRegimens(USER_ID, { tz: TZ });
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.medication.name, 'Ленватиниб');
  assert.equal(it.doseValue, 24);
  assert.equal(it.frequencyRule, 'DAILY');
  assert.equal(it.dueToday, true);
  assert.ok(it.scheduleText);
});

test('setDays: range checks, then TAKEN, overwrite, CLEAR; journal by range', { skip: SKIP }, async () => {
  const { setDays, listAdministrations } = await import('../../src/lib/meds.js');
  const base = { medicationId: ids.medicationId, regimenItemId: ids.regimenItemId, tz: TZ };
  await assert.rejects(setDays(USER_ID, { ...base, from: '2026-02-05', to: '2026-02-01', status: 'TAKEN' }), code(/^bad_range$/));
  await assert.rejects(setDays(USER_ID, { ...base, from: '2026-02-01', to: '2999-01-01', status: 'TAKEN' }), (e) => e.code === 'future' && e.kind === 'invalid' && /Будущие/.test(e.userMessage));
  await assert.rejects(setDays(USER_ID, { ...base, from: '2024-01-01', to: '2026-01-01', status: 'TAKEN' }), code(/^too_many_days$/));
  await assert.rejects(setDays(USER_ID, { ...base, medicationId: '00000000-0000-0000-0000-0000000000ff', from: '2026-02-01', to: '2026-02-01', status: 'TAKEN' }), (e) => e.code === 'medication_not_found' && e.kind === 'not_found');

  assert.deepEqual(await setDays(USER_ID, { ...base, from: '2026-02-01', to: '2026-02-03', status: 'TAKEN' }), { days: 3, inserted: 3, updated: 0, deleted: 0 });
  assert.deepEqual(await setDays(USER_ID, { ...base, from: '2026-02-03', to: '2026-02-04', status: 'SKIPPED' }), { days: 2, inserted: 1, updated: 1, deleted: 0 });
  const j = await listAdministrations(USER_ID, { medicationId: ids.medicationId, from: '2026-02-01', to: '2026-02-04', tz: TZ });
  assert.deepEqual(j.map((x) => `${x.day} ${x.status}`), ['2026-02-04 SKIPPED', '2026-02-03 SKIPPED', '2026-02-02 TAKEN', '2026-02-01 TAKEN']);
  assert.equal(j.find((x) => x.day === '2026-02-01').doseValue, 24);
  assert.deepEqual(await setDays(USER_ID, { ...base, from: '2026-02-01', to: '2026-02-04', status: 'CLEAR' }), { days: 4, inserted: 0, updated: 0, deleted: 4 });
  assert.equal((await listAdministrations(USER_ID, { from: '2026-02-01', to: '2026-02-04', tz: TZ })).length, 0);
  const ev = await db.pool.query(`select count(*)::int c from events where user_id = $1 and source = 'calendar'`, [USER_ID]);
  assert.equal(ev.rows[0].c, 0, 'calendar events are removed with the records');
});

test('updateAdministration: nothing to update, unknown id, status change', { skip: SKIP }, async () => {
  const { setDays, listAdministrations, updateAdministration } = await import('../../src/lib/meds.js');
  await setDays(USER_ID, { medicationId: ids.medicationId, regimenItemId: ids.regimenItemId, from: '2026-03-01', to: '2026-03-01', status: 'TAKEN', tz: TZ });
  const [a] = await listAdministrations(USER_ID, { from: '2026-03-01', to: '2026-03-01', tz: TZ });
  await assert.rejects(updateAdministration(USER_ID, a.id, { status: 'BOGUS' }), code(/^nothing_to_update$/));
  await assert.rejects(updateAdministration(USER_ID, '00000000-0000-0000-0000-0000000000ff', { notes: 'x' }), (e) => e.kind === 'not_found' && e.code === 'not_found');
  assert.deepEqual(await updateAdministration(USER_ID, a.id, { status: 'MISSED', notes: 'забыл' }), { id: a.id, status: 'MISSED' });
});

test('changeDose: unknown item, history, current dose and a feed note', { skip: SKIP }, async () => {
  const { changeDose, doseHistory, listRegimens } = await import('../../src/lib/meds.js');
  await assert.rejects(changeDose(USER_ID, { regimenItemId: '00000000-0000-0000-0000-0000000000ff', effectiveFrom: '2026-02-10', doseValue: 20 }), code(/^item_not_found$/));
  const out = await changeDose(USER_ID, { regimenItemId: ids.regimenItemId, effectiveFrom: '2026-02-10', doseValue: 20, reason: 'ладони', tz: TZ });
  assert.deepEqual(out.current, { doseValue: 20, doseUnit: 'mg' });
  const h = await doseHistory(USER_ID, ids.regimenItemId);
  assert.deepEqual(h.map((x) => [x.effectiveFrom, x.doseValue, x.reason]), [['2026-02-10', 20, 'ладони']]);
  assert.equal((await listRegimens(USER_ID, { tz: TZ }))[0].items[0].doseValue, 20);
  const ev = await db.pool.query(`select title from events where user_id = $1 and source = 'meds' and meta->>'what' = 'dose'`, [USER_ID]);
  assert.equal(ev.rows[0].title, 'Доза Ленватиниб: 24 → 20 мг');
});

test('updateMedication: unknown id, weekly schedule, stop ends the regimen with a note', { skip: SKIP }, async () => {
  const { updateMedication, listRegimens } = await import('../../src/lib/meds.js');
  await assert.rejects(updateMedication(USER_ID, '00000000-0000-0000-0000-0000000000ff', { name: 'x' }, { tz: TZ }), code(/^medication_not_found$/));
  await updateMedication(USER_ID, ids.medicationId, { frequencyRule: 'WEEKLY', scheduleDays: [1, 4] }, { tz: TZ });
  const it = (await listRegimens(USER_ID, { tz: TZ }))[0].items[0];
  assert.equal(it.frequencyRule, 'WEEKLY');
  assert.deepEqual(it.scheduleDays, [1, 4]);
  await updateMedication(USER_ID, ids.medicationId, { stop: true, stopDate: '2026-03-15' }, { tz: TZ });
  assert.deepEqual(await listRegimens(USER_ID, { tz: TZ }), []);
  const ev = await db.pool.query(`select title from events where user_id = $1 and meta->>'what' = 'medication_stop'`, [USER_ID]);
  assert.equal(ev.rows[0].title, 'Отменён Ленватиниб');
});
