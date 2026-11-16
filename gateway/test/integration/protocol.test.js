import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('protocol'); });
after(async () => { if (db) await db.teardown(); });

test('protocol: stored rules drive alerts, the profile carries the AI notes, apply seeds regimen and agents once', { skip: SKIP }, async () => {
  const p = await import('../../src/lib/protocol.js');
  const { labFindings } = await import('../../src/lib/alerts.js');
  const { buildPatientProfile, invalidateProfileCache } = await import('../../src/lib/patientProfile.js');
  const { getSetting } = await import('../../src/lib/settings.js');

  // Default: the general lab control, nothing stored; it has no thyroid rule, the lenvatinib preset does.
  assert.equal(getSetting(p.SETTING_KEY), null);
  assert.equal(p.getProtocol().preset, 'generic');
  assert.equal(labFindings([{ key: 'TSH', value: 12, unit: 'мЕд/л' }]).length, 0);
  await p.setProtocol(p.protocolFromPreset('lenvatinib'));
  assert.equal(labFindings([{ key: 'TSH', value: 12, unit: 'мЕд/л' }]).length, 1);

  // Custom protocol: no TSH rule, a stricter glucose rule, its own AI line.
  const custom = await p.setProtocol({ name: 'Свой протокол', aiNotes: 'Пациент на поддерживающей терапии.', labRules: [{ key: 'GLU', severity: 'RED', op: 'gt', value: 10, message: 'Глюкоза {v} {u}: высокая' }], regimen: { name: 'Препарат X', role: 'systemic', doseValue: 5, doseUnit: 'мг' }, infusionAgents: [{ name: 'Физраствор', shortName: 'NaCl', defaultDose: 500, doseUnit: 'мл' }] });
  assert.equal(custom.status, 'custom');
  assert.equal(JSON.parse(getSetting(p.SETTING_KEY)).name, 'Свой протокол');
  assert.equal(labFindings([{ key: 'TSH', value: 12, unit: 'мЕд/л' }]).length, 0);
  assert.equal(labFindings([{ key: 'GLU', value: 11, unit: 'ммоль/л' }])[0].message, 'Глюкоза 11 ммоль/л: высокая');
  invalidateProfileCache();
  assert.match(await buildPatientProfile(USER_ID), /^Протокол лечения «Свой протокол»: Пациент на поддерживающей терапии\./);

  // Apply: the regimen is created once, agents are added without duplicates.
  const { createMedication, hasActiveSystemic } = await import('../../src/lib/medsCreate.js');
  const inf = await import('../../src/lib/infusions.js');
  assert.equal(await hasActiveSystemic(USER_ID), false);
  await createMedication(USER_ID, { ...p.getProtocol().regimen, startDate: '2026-03-01' });
  assert.equal(await hasActiveSystemic(USER_ID), true);
  const reg = await db.pool.query(`select m.name, ri.dose_value, r.start_date::text as start from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id where r.user_id = $1`, [USER_ID]);
  assert.deepEqual(reg.rows.map((x) => [x.name, Number(x.dose_value), x.start]), [['Препарат X', 5, '2026-03-01']]);
  assert.equal(await inf.addProtocolAgents(USER_ID), 1);
  assert.equal(await inf.addProtocolAgents(USER_ID), 0);
  assert.deepEqual((await inf.listAgents(USER_ID)).map((a) => a.shortName), ['NaCl']);

  // Back to a preset: the stored copy carries the preset id and its rules.
  const back = await p.setProtocol(p.protocolFromPreset('generic'));
  assert.equal(back.preset, 'generic');
  assert.equal(back.status, 'example');
  assert.equal(labFindings([{ key: 'NEUT#', value: 0.5, unit: '×10⁹/л' }])[0].severity, 'RED');
  invalidateProfileCache();
  assert.doesNotMatch(await buildPatientProfile(USER_ID), /Протокол лечения/);
});

test('tacrolimus: a report row lands in TAC (µg/L counted as ng/mL) and the transplant preset flags a high level', { skip: SKIP }, async () => {
  const p = await import('../../src/lib/protocol.js');
  const { commitParsed } = await import('../../src/lib/labsCommit.js');
  const { PDF } = await import('./helpers.js');
  await p.setProtocol(p.protocolFromPreset('kidney-transplant'));
  const parsed = { lab_name: 'Демо', doc_date: '2026-03-10', observations: [
    { test_name_raw: 'Такролимус, остаточная концентрация', result_num: 17.2, result_text: '17,2', unit_raw: 'мкг/л', ref_low: 5, ref_high: 10 },
  ] };
  const r = await commitParsed({ userId: USER_ID, buf: Buffer.concat([PDF, Buffer.from('tac')]), filename: 'tac.pdf', parsed });
  assert.equal(r.inserted, 1);
  assert.equal(r.alertsRaised, 1);
  const row = (await db.pool.query(`select t.canonical_key, r.value_numeric, r.unit_canonical from lab_results r join lab_tests t on t.id = r.test_id where r.document_id = $1`, [r.documentId])).rows[0];
  assert.deepEqual([row.canonical_key, Number(row.value_numeric), row.unit_canonical], ['TAC', 17.2, 'нг/мл']);
  const alert = (await db.pool.query(`select context from alerts where user_id = $1 and context->>'dedup' like 'lab:TAC:%'`, [USER_ID])).rows[0];
  assert.match(alert.context.message, /Такролимус 17,2 нг\/мл: высокая концентрация/);
});
