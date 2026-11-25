import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

// docs/I18N.md: with users.locale = en everything the gateway writes for a person, and the AI, is in English; what the
// patient typed stays. The stored data here is written the way a Russian user writes it.
const TZ = 'Europe/Moscow';
const CHAT = process.env.TELEGRAM_CHAT_ID || '111';
let db; let app; let bot; let sent; let calls;
const setLanguage = async (language, prefs = {}) => {
  await db.pool.query('update users set locale = $2, prefs = $3 where id = $1', [USER_ID, language, JSON.stringify(prefs)]);
  (await import('../../src/lib/patientProfile.js')).invalidateProfileCache();
};
const get = (url) => app.inject({ method: 'GET', url });
const pdfText = async (url) => {
  const r = await get(url); assert.equal(r.statusCode, 200, r.body);
  const { pdfTextPages } = await import('../../src/lib/pdfText.js');
  return { text: (await pdfTextPages(r.rawPayload)).pages.join('\n').replace(/\s+/g, ' '), name: decodeURIComponent(r.headers['content-disposition']) };
};

before(async () => {
  if (SKIP) return;
  process.env.LLM_PROVIDER = 'custom'; process.env.LLM_BASE_URL = 'https://model.test/v1'; process.env.LLM_MODEL = 'stub';
  db = await setupDb('i18noutput');
  const { CoreError, HTTP_STATUS, errorBody } = await import('../../src/lib/errors.js');
  app = Fastify();
  app.decorate('authenticate', async (req) => { req.user = { sub: USER_ID, tz: TZ }; });
  app.setErrorHandler((err, _r, reply) => (err instanceof CoreError ? reply.code(HTTP_STATUS[err.kind]).send(errorBody(err)) : reply.code(500).send({ error: err.message })));
  await app.register((await import('@fastify/multipart')).default);
  for (const r of ['report', 'labsExport', 'export']) await app.register((await import(`../../src/routes/${r}.js`)).default);
  const { setProtocol, protocolFromPreset } = await import('../../src/lib/protocol.js');
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { saveSymptoms } = await import('../../src/lib/symptoms.js');
  const { createStudy } = await import('../../src/lib/imaging.js');
  const { createMilestone } = await import('../../src/lib/milestones.js');
  await setProtocol(protocolFromPreset('lenvatinib'));
  await seedRegimen(db.pool);
  const today = (await import('../../src/lib/dates.js')).todayKey(TZ);
  await commitManual(USER_ID, { date: today, labName: 'Лаборатория', rows: [{ key: 'ALT', value: '138' }, { key: 'HGB', value: '110' }, { name: 'Редкий маркер', value: 'отрицательно' }] }, { tz: TZ });
  await saveSymptoms(USER_ID, today, { wellbeing: 3, bpSys: 165, bpDia: 95, weightKg: 67.4, diarrhea: 2, notes: 'гулял' }, TZ);
  await createStudy(USER_ID, { date: today, modality: 'КТ', region: 'Грудь', response: 'PR' }, { tz: TZ });
  await createMilestone(USER_ID, { date: today, kind: 'surgery', tone: 'neutral', title: 'Резекция' }, { tz: TZ });
  calls = [];
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {}, model: 'stub' }), { status: 200 }); };
  const { createTelegramBot } = await import('../../src/lib/telegramBot.js');
  sent = [];
  bot = createTelegramBot({ userId: USER_ID, log: db.quiet, fetchImpl: async () => { throw new Error('no network'); }, tg: { send: async (text, _c, extra) => { sent.push({ text, extra }); }, edit: async () => {}, answer: async () => {} } });
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

const say = (text) => bot.handle({ chat: { id: CHAT }, from: { username: 'u' }, text });

test('the doctor report PDF in English: headers, footer, dates, file name', { skip: SKIP }, async () => {
  await setLanguage('en', { region: 'US' });
  const { text, name } = await pdfText('/report/doctor.pdf?sections=therapy,milestones,imaging,labs,symptoms,alerts');
  for (const s of ['Doctor report', 'Therapy', 'Imaging and lesion trends', 'Labs', 'MARKER LATEST DATE PREVIOUS REF. RANGE UNIT', 'Wellbeing from the diary', 'Alerts in the period', 'page 1 of', 'does not replace medical documents', 'partial response']) assert.ok(text.includes(s), s);
  assert.match(text, /Blood pressure: average 165\/95/);
  assert.match(text, /148\.6 lb/, 'weight in the user\'s units');
  assert.match(name, /MedControl-report-/);
  for (const s of ['Отчёт для врача', 'Терапия', 'стр.', 'Норма']) assert.ok(!text.includes(s), s);
  assert.ok(text.includes('Резекция'), 'what the patient typed stays');
});

test('explicitly empty doctor report selection cannot export patient data', { skip: SKIP }, async () => {
  const r = await get('/report/doctor.pdf?sections=');
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'report_sections_required');
});

test('the doctor report in Russian keeps its words and its file name', { skip: SKIP }, async () => {
  await setLanguage('ru');
  const { text, name } = await pdfText('/report/doctor.pdf?sections=therapy');
  assert.ok(text.includes('Отчёт для врача'));
  assert.match(text, /стр\. 1 из/);
  assert.match(name, /MedControl-otchet-/);
});

test('lab exports in English: sheets, columns, CSV format, JSONL, file names', { skip: SKIP }, async () => {
  await setLanguage('en', { region: 'US' });
  const csv = await get('/labs/export/results.csv');
  const head = csv.body.replace(/^﻿/, '').split('\r\n')[0];
  assert.equal(head, 'Date,Marker,As printed,Key,Category,Value,Result as printed,Unit,Range from,Range to,Deviation,Lab,Document');
  assert.match(csv.headers['content-disposition'], /medcontrol-labs-all/);
  assert.match(csv.body, /above range/);
  const lines = (await get('/labs/export/observations.jsonl')).body.split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.find((x) => x.key === 'ALT').category, 'blood');
  assert.equal(lines.find((x) => x.key === 'ALT').flag, 'above range');
  assert.ok(!('flagCode' in lines[0]));
  const xlsx = await get('/labs/export/summary.xlsx');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx.rawPayload);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'All results', 'Catalog']);
  assert.equal(wb.worksheets[1].getCell('A2').numFmt, 'mm/dd/yyyy');
  assert.equal(wb.worksheets[2].getCell('F1').value, 'Key marker');
  const { text } = await pdfText('/labs/export/summary.pdf');
  for (const s of ['Lab summary', 'Blood', 'REF. RANGE', 'page 1 of 1', 'does not replace lab reports']) assert.ok(text.includes(s), s);
});

test('lab exports in Russian keep the «;» table and the decimal comma', { skip: SKIP }, async () => {
  await setLanguage('ru');
  const csv = await get('/labs/export/results.csv');
  assert.match(csv.body, /^﻿Дата;Показатель;Как в документе;/);
  assert.match(csv.headers['content-disposition'], /medcontrol-analizy-vse/);
});

test('the Markdown file for AI apps and the archive in English', { skip: SKIP }, async () => {
  await setLanguage('en');
  const { buildDossierMarkdown } = await import('../../src/lib/dossierExport.js');
  await db.pool.query(`insert into ai_comments (user_id, subject_type, subject_id, model, text) values ($1,'labs_month','2026-01','m','Past review')`, [USER_ID]);
  const { getSetting } = await import('../../src/lib/settings.js');
  assert.equal(getSetting('anamnesis') ?? null, null);
  const md = await buildDossierMarkdown(USER_ID, { tz: TZ, withAi: true });
  for (const s of ['# Patient data from MedControl', '**Instructions for the AI assistant.**', '## 2. Therapy', 'Date | Value | Unit | Reference | Lab', '## 11. Latest lab assessment by another model (AI answer, not fact)', 'Does not replace medical documents']) assert.ok(md.includes(s), s);
  assert.ok(md.includes('Past review'), 'the part after the heading of the review is found in English too');
  assert.ok(!md.includes('Анамнез'));
  const r = await get('/export/dossier.md');
  assert.match(r.headers['content-disposition'], /medcontrol-dossier-/);
  const zip = await get('/export/all.zip');
  assert.match(zip.headers['content-disposition'], /medcontrol-export-/);
  assert.equal(zip.statusCode, 200);
});

test('the bot in English: help, marks, diary line, status, in either language', { skip: SKIP }, async () => {
  await setLanguage('en');
  await say('hello');
  assert.match(sent.at(-1).text, /Here is what I can do/);
  await say('taken');
  assert.match(sent.at(-1).text, /Ленватиниб 24 mg marked taken for today/);
  await say('принял');
  assert.match(sent.at(-1).text, /is already marked: taken/, 'the Russian word works with the English setting');
  await say('status');
  assert.match(sent.at(-1).text, /Ленватиниб: taken/);
  await say('pressure 120/80, nausea 1, fatigue 2, weight 70');
  assert.match(sent.at(-1).text, /Diary for today: .*BP 120\/80 · 70 kg · fatigue 2/);
  await say('no nausea');
  assert.match(sent.at(-1).text, /Diary for today/, 'not a skipped dose');
  await setLanguage('ru');
  await say('pressure 121/81');
  assert.match(sent.at(-1).text, /Дневник за сегодня: .*АД 121\/81/, 'the English words work with the Russian setting');
  await say('привет');
  assert.match(sent.at(-1).text, /^Я умею:/);
});

test('reminders in English, with buttons', { skip: SKIP }, async () => {
  await setLanguage('en');
  await db.pool.query('delete from administrations'); await db.pool.query('delete from notifications');
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  const { todayKey } = await import('../../src/lib/dates.js');
  const out = [];
  const stop = startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3600e3, now: () => new Date(`${todayKey(TZ)}T08:30:00Z`), sendImpl: async (text, _c, extra) => { out.push({ text, extra }); }, readyImpl: () => true });
  await stop.tick(); stop();
  const dose = out.find((x) => x.text.includes('💊'));
  assert.match(dose.text, /is not marked yet today/);
  assert.deepEqual(dose.extra.reply_markup.inline_keyboard[0].map((b) => b.text), ['✅ Mark taken', 'Skip']);
  assert.ok(out.some((x) => /Blood pressure 165\/95/.test(x.text)), 'an alert stored in Russian follows the language');
});

test('the AI: the English prompt for en, the Russian one for ru, the profile in that language', { skip: SKIP }, async () => {
  const { commentLabDocument } = await import('../../src/lib/labsAi.js');
  const { buildPatientProfile, invalidateProfileCache } = await import('../../src/lib/patientProfile.js');
  const doc = (await db.pool.query('select id from ingest_documents limit 1')).rows[0].id;
  const system = (c) => { const m = c.messages[0].content; return typeof m === 'string' ? m : m[0].text; };
  const user = (c) => { const m = c.messages[1].content; return typeof m === 'string' ? m : m.map((x) => x.text).join('\n'); };

  await setLanguage('en'); calls.length = 0;
  await commentLabDocument(USER_ID, doc);
  assert.match(system(calls[0]), /Write in English/);
  assert.match(system(calls[0]), /not a doctor/);
  assert.match(user(calls[0]), /PATIENT DATA/);
  assert.match(user(calls[0]), /Open alerts: .*ALT 138 U\/L: more than 3× the upper limit/);
  assert.match(user(calls[0]), /Document: Лаборатория, date /);
  assert.match(user(calls[0]), /Treatment protocol "Lenvatinib"/);

  await setLanguage('ru'); calls.length = 0;
  await commentLabDocument(USER_ID, doc);
  assert.match(system(calls[0]), /Пиши по-русски/);
  assert.match(user(calls[0]), /ДАННЫЕ ПАЦИЕНТА/);

  invalidateProfileCache();
  const ru = await buildPatientProfile(USER_ID, { tz: TZ, language: 'ru' });
  const en = await buildPatientProfile(USER_ID, { tz: TZ, language: 'en' });
  assert.match(ru, /^Протокол лечения/);
  assert.match(en, /^Treatment protocol/, 'the profile is cached per language');
  assert.match(en, /Therapy: Ленватиниб 24 mg once a day/);
});

test('English full text search works through the russian configuration', { skip: SKIP }, async () => {
  const { createNote } = await import('../../src/lib/notes.js');
  const { searchAll } = await import('../../src/lib/search.js');
  await createNote(USER_ID, { title: 'Running notes', body: 'The patients were running daily and sleeping badly.' }, { tz: TZ });
  const hit = async (q) => (await searchAll(USER_ID, q)).results.some((x) => x.kind === 'note');
  assert.equal(await hit('patient'), true, 'an English word is stemmed');
  assert.equal(await hit('run'), true);
  assert.equal(await hit('sleep'), true);
  assert.equal(await hit('zebra'), false);
});
