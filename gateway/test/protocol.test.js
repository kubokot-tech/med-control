import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, ProtocolSchema, protocolFromPreset, getProtocol, listPresets, withStatus, mergePresetScales } from '../src/lib/protocol.js';
import { labFindings } from '../src/lib/alerts.js';
import { SCALE_KEYS, DEFAULT_SCALES } from '../src/lib/diaryScales.js';

test('every preset validates and uses catalog keys only', () => {
  for (const p of PRESETS) {
    const proto = protocolFromPreset(p.id);
    assert.equal(proto.preset, p.id);
    assert.ok(proto.labRules.length > 0);
  }
  const list = listPresets();
  assert.equal(list[0].id, 'generic', 'general monitoring leads the list: it fits any condition');
  assert.match(list[0].summary, /любого долгого наблюдения/);
  assert.ok(list.length >= 7);
  const others = list.filter((p) => p.id !== 'lenvatinib');
  assert.equal(list.find((p) => p.id === 'lenvatinib').status, 'ready');
  assert.ok(others.every((p) => p.status === 'example'), 'every other preset is an example');
  assert.ok(others.every((p) => /не провер/.test(p.summary)), 'examples say they were not reviewed by a doctor');
  for (const p of PRESETS) assert.ok(p.diaryScales.length >= 5 && p.diaryScales.every((k) => SCALE_KEYS.includes(k)), `${p.id}: diary scales`);
  assert.deepEqual(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length, 'unique ids');
});

test('default protocol is the general lab control when nothing is stored', () => {
  const p = getProtocol();
  assert.equal(p.preset, 'generic');
  assert.ok(p.labRules.some((r) => r.key === 'ALT'));
  assert.equal(labFindings([{ key: 'K', value: 6, unit: 'ммоль/л' }]).length, 1);
});

test('schema rejects unknown catalog keys and bad operators', () => {
  const base = protocolFromPreset('generic');
  assert.throws(() => ProtocolSchema.parse({ ...base, labRules: [{ key: 'NOPE', severity: 'RED', op: 'lt', value: 1, message: 'x' }] }));
  assert.throws(() => ProtocolSchema.parse({ ...base, labRules: [{ key: 'ALT', severity: 'RED', op: 'between', value: 1, message: 'x' }] }));
  assert.throws(() => ProtocolSchema.parse({ ...base, name: '' }));
  const ok = ProtocolSchema.parse({ name: 'Свой', labRules: [] });
  assert.equal(ok.status, 'custom');
  assert.deepEqual(ok.infusionAgents, []);
});

test('status follows the preset only while the content matches it', () => {
  assert.equal(withStatus(protocolFromPreset('generic')).status, 'example');
  const edited = withStatus({ ...protocolFromPreset('generic'), aiNotes: 'моя правка' });
  assert.equal(edited.status, 'custom');
  assert.equal(edited.preset, 'generic');
  assert.equal(withStatus({ ...protocolFromPreset('lenvatinib'), preset: null }).status, 'custom');
});

test('older stored protocols get diary scales from their preset or the default list', async () => {
  const { normalizeProtocol, ProtocolSchema } = await import('../src/lib/protocol.js');
  const old = ProtocolSchema.parse({ name: 'Ленватиниб', preset: 'lenvatinib', labRules: [] });
  assert.ok(normalizeProtocol(old).diaryScales.includes('handFoot'));
  assert.deepEqual(normalizeProtocol(ProtocolSchema.parse({ name: 'Свой', labRules: [] })).diaryScales, DEFAULT_SCALES);
  assert.deepEqual(normalizeProtocol({ ...old, diaryScales: ['edema', 'edema', 'itch'] }).diaryScales, ['edema', 'itch']);
  assert.throws(() => ProtocolSchema.parse({ name: 'x', diaryScales: ['nope'] }));
});

test('a protocol stored with a preset summary reworded since still counts as its preset', async () => {
  const { normalizeProtocol } = await import('../src/lib/protocol.js');
  const now = protocolFromPreset('generic');
  const old = { ...now, summary: 'Без привязки к препарату: только базовые пороги по крови, печени, почкам и калию. Пример, не проверен врачом.' };
  assert.equal(normalizeProtocol(old).summary, now.summary);
  assert.equal(withStatus(normalizeProtocol(old)).status, 'example');
  assert.equal(normalizeProtocol({ ...now, summary: 'Моё описание' }).summary, 'Моё описание');
});

test('a preset change keeps the scales the user added, not the previous preset\'s', () => {
  const lenva = protocolFromPreset('lenvatinib');
  const dialysis = protocolFromPreset('hemodialysis');
  const extra = SCALE_KEYS.find((k) => !lenva.diaryScales.includes(k) && !dialysis.diaryScales.includes(k));
  const current = { ...lenva, diaryScales: [...lenva.diaryScales, extra] };
  const next = mergePresetScales(dialysis, current);
  assert.ok(next.diaryScales.includes(extra), 'own scale kept');
  for (const k of dialysis.diaryScales) assert.ok(next.diaryScales.includes(k));
  for (const k of lenva.diaryScales.filter((x) => !dialysis.diaryScales.includes(x))) assert.ok(!next.diaryScales.includes(k), `${k} came only with lenvatinib`);
  assert.equal(withStatus(next).status, dialysis.status, 'scales do not make a preset «custom»');
  assert.ok(mergePresetScales(dialysis, { diaryScales: SCALE_KEYS }).diaryScales.length <= 20);
});

test('presets for conditions that are not cancer: thyroid and endometriosis', () => {
  const thyroid = protocolFromPreset('hypothyroidism');
  assert.deepEqual(thyroid.labRules.filter((r) => r.key === 'TSH').map((r) => [r.op, r.value]), [['gt', 10], ['lt', 0.1]]);
  assert.equal(thyroid.regimen.doseValue, null, 'the dose is the doctor\'s, the preset does not suggest one');
  const endo = protocolFromPreset('endometriosis');
  assert.ok(endo.labRules.some((r) => r.key === 'FERR' && r.op === 'lt' && r.value === 15));
  assert.equal(endo.infusionAgents.length, 1);
  assert.ok(endo.diaryScales.includes('pain'));
  const ids = listPresets().map((p) => p.id);
  assert.ok(ids.indexOf('hypothyroidism') < ids.indexOf('lenvatinib') && ids.indexOf('endometriosis') < ids.indexOf('lenvatinib'), 'oncology does not lead the list');
  for (const lang of ['ru', 'en']) for (const p of listPresets(lang).filter((x) => ['hypothyroidism', 'endometriosis'].includes(x.id))) assert.ok(p.name && p.summary && !p.name.startsWith('presets.'), `${lang} ${p.id}`);
});
