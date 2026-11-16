import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SKIP, USER_ID, setupDb } from './helpers.js';

// docs/I18N.md: with language = en the same data answers in English; with ru the answers are what they always were.
const TZ = 'Europe/Moscow';
const CYRILLIC = /[А-Яа-яЁё]/;
let db; let app;

const setLanguage = (language) => db.pool.query('update users set locale = $2 where id = $1', [USER_ID, language]);
const get = async (url) => { const r = await app.inject({ method: 'GET', url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };

before(async () => {
  if (SKIP) return;
  db = await setupDb('i18napi');
  const { CoreError, HTTP_STATUS, errorBody } = await import('../../src/lib/errors.js');
  app = Fastify();
  app.decorate('authenticate', async (req) => { req.user = { sub: USER_ID, tz: TZ }; });
  app.setErrorHandler((err, _req, reply) => (err instanceof CoreError ? reply.code(HTTP_STATUS[err.kind]).send(errorBody(err)) : reply.code(500).send({ error: 'internal', message: err.message })));
  for (const r of ['labs', 'labsExport', 'report', 'protocol', 'alerts', 'timeline', 'meds', 'milestones', 'labRefs', 'infusions', 'home', 'search', 'setup']) await app.register((await import(`../../src/routes/${r}.js`)).default);

  // written the way a Russian user writes: everything stored in Russian
  const { setProtocol, protocolFromPreset } = await import('../../src/lib/protocol.js');
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { saveSymptoms } = await import('../../src/lib/symptoms.js');
  const { createMedication } = await import('../../src/lib/medsCreate.js');
  const { createStudy } = await import('../../src/lib/imaging.js');
  await setProtocol(protocolFromPreset('lenvatinib'));
  await commitManual(USER_ID, { date: '2026-03-04', labName: 'Лаборатория', rows: [{ key: 'ALT', value: '138' }, { key: 'NEUT#', value: '0,8' }, { key: 'HGB', value: '125' }] }, { tz: TZ });
  await saveSymptoms(USER_ID, '2026-03-05', { wellbeing: 3, bpSys: 165, bpDia: 95, weightKg: 67.4, pulse: 74, diarrhea: 2 }, TZ);
  await createMedication(USER_ID, { name: 'Ленватиниб', role: 'systemic', doseValue: 24, doseUnit: 'мг', timesPerDay: 2, startDate: '2026-01-01' }, TZ);
  await createStudy(USER_ID, { date: '2026-03-06', modality: 'КТ', region: 'Грудь', response: 'PR' }, { tz: TZ });
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

test('labs: names and units follow the language, the values and the database do not', { skip: SKIP }, async () => {
  await setLanguage('ru');
  const ru = await get('/labs/summary');
  const alt = ru.rows.find((r) => r.test === 'ALT');
  assert.deepEqual([alt.short, alt.name, alt.unit], ['АЛТ', 'Аланинаминотрансфераза (АЛТ)', 'Ед/л']);
  const ruSeries = await get('/labs/series?key=NEUT%23');
  assert.deepEqual([ruSeries.short, ruSeries.unit, ruSeries.points[0].unit], ['Нейтрофилы', '×10⁹/л', '×10⁹/л']);

  await setLanguage('en');
  const en = await get('/labs/summary');
  const altEn = en.rows.find((r) => r.test === 'ALT');
  assert.deepEqual([altEn.short, altEn.name, altEn.unit], ['ALT', 'Alanine aminotransferase (ALT)', 'U/L']);
  assert.equal(altEn.cells['2026-03'].valueNum, alt.cells['2026-03'].valueNum);
  const enSeries = await get('/labs/series?key=NEUT%23');
  assert.deepEqual([enSeries.short, enSeries.unit, enSeries.points[0].unit], ['Neutrophils', '×10⁹/L', '×10⁹/L']);
  const overview = await get('/labs/overview?keys=HGB');
  assert.equal(overview.cards[0].short, 'Hemoglobin');
  assert.equal(overview.cards[0].last.unit, 'g/L');
  assert.equal((await get('/labs/catalog')).items.find((c) => c.key === 'CREA').unit, 'µmol/L');
  assert.equal((await get('/labs/refs')).items.find((c) => c.key === 'K').name, 'Potassium');
  const stored = await db.pool.query(`select unit_canonical from lab_results r join lab_tests t on t.id = r.test_id where t.canonical_key = 'ALT'`);
  assert.equal(stored.rows[0].unit_canonical, 'Ед/л');
});

test('protocol: presets, rule texts and scales in English, Russian as before, an English screen saved back stays the preset', { skip: SKIP }, async () => {
  await setLanguage('ru');
  const ru = await get('/protocol');
  assert.equal(ru.protocol.name, 'Ленватиниб');
  assert.equal(ru.scaleCatalog[0].label, 'Усталость');
  assert.equal(ru.catalog.find((c) => c.key === 'ALT').name, 'Аланинаминотрансфераза (АЛТ)');

  await setLanguage('en');
  const en = await get('/protocol');
  assert.doesNotMatch(JSON.stringify({ protocol: en.protocol, presets: en.presets, catalog: en.catalog, scales: en.scaleCatalog }), CYRILLIC);
  assert.equal(en.protocol.name, 'Lenvatinib');
  assert.equal(en.protocol.status, 'ready');
  assert.deepEqual(en.protocol.labRules.map((r) => r.value), ru.protocol.labRules.map((r) => r.value));

  const put = await app.inject({ method: 'PUT', url: '/protocol', payload: en.protocol });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().protocol.status, 'ready');
  assert.equal(put.json().protocol.name, 'Lenvatinib');
  await setLanguage('ru');
  assert.deepEqual((await get('/protocol')).protocol, ru.protocol, 'nothing changed for the Russian reader');
});

test('alerts stored in Russian read in English, and new ones are written in the user\'s language', { skip: SKIP }, async () => {
  await setLanguage('ru');
  const ru = (await get('/alerts')).alerts;
  const neut = ru.find((a) => a.key === 'NEUT#');
  assert.equal(neut.message, 'Нейтрофилы 0,8 ×10⁹/л: тяжёлая нейтропения, риск инфекции. Связаться с лечащим врачом сегодня.');

  await setLanguage('en');
  const en = (await get('/alerts')).alerts;
  assert.equal(en.length, ru.length);
  for (const a of en) assert.doesNotMatch(a.message, CYRILLIC, a.message);
  // the region stays Russian: English words, a decimal comma (docs/I18N.md, two axes)
  assert.equal(en.find((a) => a.key === 'NEUT#').message, 'Neutrophils 0,8 ×10⁹/L: severe neutropenia, risk of infection. Contact the treating doctor today.');

  const { saveSymptoms } = await import('../../src/lib/symptoms.js');
  await saveSymptoms(USER_ID, new Date().toISOString().slice(0, 10), { bpSys: 150, bpDia: 85 }, TZ);
  const row = await db.pool.query(`select context->>'message' as m from alerts where context->>'key' = 'BP' and context->>'severity' = 'YELLOW'`);
  assert.match(row.rows[0].m, /^Blood pressure 150\/85:/, 'stored in English');
  await setLanguage('ru');
  assert.ok((await get('/alerts')).alerts.some((a) => a.message.startsWith('Давление 150/85: выше 140/90.')), 'and reads in Russian');
});

test('the feed: titles built by the gateway follow the language', { skip: SKIP }, async () => {
  await setLanguage('ru');
  const ru = (await get('/timeline?limit=50')).items;
  assert.equal(ru.find((x) => x.type === 'SYMPTOM' && x.day === '2026-03-05').symptom.summary, 'самочувствие 3/5 · АД 165/95 · 67.4 кг · пульс 74 · диарея 2');
  assert.equal(ru.find((x) => x.type === 'MILESTONE').title, 'Контроль КТ/МРТ/ПЭТ: КТ Грудь: частичный ответ');
  assert.match(ru.find((x) => x.type === 'NOTE').title, /^Назначен Ленватиниб 24 мг$/);

  await setLanguage('en');
  const en = (await get('/timeline?limit=50')).items;
  assert.equal(en.find((x) => x.type === 'SYMPTOM' && x.day === '2026-03-05').symptom.summary, 'wellbeing 3/5 · BP 165/95 · 67,4 kg · pulse 74 · diarrhea 2');
  assert.equal(en.find((x) => x.type === 'MILESTONE').title, 'CT/MRI/PET follow-up: CT Грудь: partial response');
  assert.equal(en.find((x) => x.type === 'NOTE').title, 'Started Ленватиниб 24 mg');
});

test('medications: the schedule text follows the language', { skip: SKIP }, async () => {
  await setLanguage('ru');
  assert.equal((await get('/meds/regimens')).regimens[0].items[0].scheduleText, '2 раза в день');
  await setLanguage('en');
  assert.equal((await get('/meds/regimens')).regimens[0].items[0].scheduleText, 'twice a day');
  const doses = (await get(`/meds/doses?regimen_item_id=${(await get('/meds/regimens')).regimens[0].items[0].id}`)).doses;
  assert.equal(doses[0].reason, 'initial dose');
  await setLanguage('ru');
  assert.equal((await get(`/meds/doses?regimen_item_id=${(await get('/meds/regimens')).regimens[0].items[0].id}`)).doses[0].reason, 'назначение');
});

test('milestones: a generated title follows the language, a typed one does not', { skip: SKIP }, async () => {
  const { createMilestone } = await import('../../src/lib/milestones.js');
  await setLanguage('ru');
  await createMilestone(USER_ID, { date: '2026-02-01', kind: 'surgery', title: 'Резекция' }, { tz: TZ });
  const ru = (await get('/milestones')).milestones;
  assert.equal(ru.find((m) => m.kind === 'imaging').title, 'КТ Грудь: частичный ответ');
  assert.equal(ru.find((m) => m.kind === 'surgery').title, 'Резекция');
  await setLanguage('en');
  const en = (await get('/milestones')).milestones;
  assert.equal(en.find((m) => m.kind === 'imaging').title, 'CT Грудь: partial response');
  assert.equal(en.find((m) => m.kind === 'surgery').title, 'Резекция');
  await createMilestone(USER_ID, { date: '2026-02-02', kind: 'surgery', title: 'Biopsy' }, { tz: TZ });
  const ev = await db.pool.query(`select title from events where type = 'MILESTONE' order by created_at desc limit 1`);
  assert.equal(ev.rows[0].title, 'Surgery: Biopsy', 'a new feed title is written in the user\'s language');
  await setLanguage('ru');
});

test('exports and the doctor report keep working and follow the language in markers and units', { skip: SKIP }, async () => {
  const file = async (url) => { const r = await app.inject({ method: 'GET', url }); assert.equal(r.statusCode, 200, url); return r; };
  await setLanguage('en');
  for (const u of ['/report/doctor.pdf', '/labs/export/summary.pdf', '/labs/export/summary.xlsx']) assert.ok((await file(u)).rawPayload.length > 1000, u);
  assert.match((await file('/labs/export/results.csv')).body, /Alanine aminotransferase \(ALT\).*U\/L/);
  await setLanguage('ru');
  for (const u of ['/report/doctor.pdf', '/labs/export/summary.pdf', '/labs/export/summary.xlsx']) assert.ok((await file(u)).rawPayload.length > 1000, u);
  assert.match((await file('/labs/export/results.csv')).body, /Аланинаминотрансфераза \(АЛТ\).*Ед\/л/);
});

test('infusion agents from a preset come in the user\'s language, once', { skip: SKIP }, async () => {
  await setLanguage('en');
  const agents = (await get('/infusions')).agents;
  assert.deepEqual(agents.map((a) => a.shortName), ['IVC', 'Glutathione', 'Heptral']);
  await setLanguage('ru');
  const { addProtocolAgents } = await import('../../src/lib/infusions.js');
  assert.equal(await addProtocolAgents(USER_ID, 'ru'), 0, 'the same agents in another language are the same agents');
  assert.equal((await get('/infusions')).agents.length, 3);
});

test('search: titles and markers follow the language, a marker is found by its Russian name too', { skip: SKIP }, async () => {
  await setLanguage('en');
  const byRu = (await get(`/search?q=${encodeURIComponent('креатинин')}`)).results;
  assert.equal(byRu[0].title, 'Marker: Creatinine');
  assert.equal(byRu[0].snippet, 'blood');
  assert.equal((await get('/search?q=creatinine')).results[0].id, 'CREA');
  assert.ok((await get(`/search?q=${encodeURIComponent('Ленватиниб')}`)).results.some((x) => x.title === 'Medication: Ленватиниб'));
  await setLanguage('ru');
  const ru = (await get(`/search?q=${encodeURIComponent('креатинин')}`)).results;
  assert.equal(ru[0].title, 'Показатель: Креатинин');
  assert.equal(ru[0].snippet, 'кровь');
  assert.ok((await get(`/search?q=${encodeURIComponent('Ленватиниб')}`)).results.some((x) => x.title === 'Препарат: Ленватиниб'));
});

test('the first-run wizard lists presets in the language it asks for', { skip: SKIP }, async () => {
  assert.equal((await get('/setup/status?language=en')).presets.find((p) => p.id === 'generic').name, 'General lab monitoring');
  assert.equal((await get('/setup/status')).presets.find((p) => p.id === 'generic').name, 'Общий контроль анализов');
});

test('good news on the home screen follows the language', { skip: SKIP }, async () => {
  await setLanguage('en');
  const { homeHuman } = await import('../../src/lib/homeHuman.js');
  const today = new Date().toISOString().slice(0, 10);
  const { createStudy } = await import('../../src/lib/imaging.js');
  await setLanguage('ru');
  await createStudy(USER_ID, { date: today, modality: 'МРТ', region: 'Голова', response: 'CR' }, { tz: TZ });
  await setLanguage('en');
  const human = await homeHuman(USER_ID, TZ);
  assert.equal(human.goodNews[0].title, 'MRI Голова: complete response');
  await setLanguage('ru');
});
