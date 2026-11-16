import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, PDF, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('extract'); });
after(async () => { if (db) await db.teardown(); });

test('text layer via ingestion, scan via a model that sees it, AI context includes the file text', { skip: SKIP }, async () => {
  const notes = await import('../../src/lib/notes.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const ex = await import('../../src/lib/notesExtract.js');
  const { noteContext } = await import('../../src/lib/notesAi.js');
  const n = await notes.createNote(USER_ID, { title: 'Статья', body: 'см. файл' });
  const a = await storeAttachment(db.pool, USER_ID, n.eventId, PDF, 'application/pdf', 'article.pdf');
  const fetchText = async () => new Response(JSON.stringify({ pages: 2, chars: 4000, text: 'Абстракт статьи про терапию.' }), { status: 200 });
  const x1 = await ex.extractAttachment(USER_ID, n.id, a.sha256, { mode: 'auto', fetchImpl: fetchText, chat: async () => { throw new Error('model must not be called'); } });
  assert.equal(x1.method, 'pdf_text');
  const ctx = await noteContext(USER_ID, n.id);
  assert.match(ctx.text, /ТЕКСТ ПРИЛОЖЕННОГО ФАЙЛА «article.pdf» \(текстовый слой PDF\)\nАбстракт статьи про терапию\./);
  const fetchScan = async () => new Response(JSON.stringify({ pages: 3, chars: 10, text: '' }), { status: 200 });
  let sent = null;
  const x2 = await ex.extractAttachment(USER_ID, n.id, a.sha256, { mode: 'auto', fetchImpl: fetchScan, sees: () => true, ocr: async () => { throw new Error('no local OCR when the model sees the scan'); }, chat: async (args) => { sent = args; return { text: '# Скан\n\nТекст.', model: 'stub', truncated: false }; } });
  assert.equal(x2.method, 'llm');
  assert.equal(sent.files.length, 1, 'PDF handed to the model');
  await assert.rejects(ex.extractAttachment(USER_ID, n.id, a.sha256, { mode: 'text', fetchImpl: fetchScan }), (e) => e.code === 'no_text_layer');
  assert.deepEqual((await ex.listExtracts(USER_ID, n.id)).map((e) => e.method), ['llm']);
  const updated = await ex.insertExtractIntoNote(USER_ID, n.id, a.sha256);
  assert.match(updated.body, /см\. файл\n\n## Файл: article\.pdf\n\n# Скан\n\nТекст\./);
});

test('a scan is recognised here when the AI cannot see images or with «Достать текст» (mode ocr)', { skip: SKIP }, async () => {
  const notes = await import('../../src/lib/notes.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const ex = await import('../../src/lib/notesExtract.js');
  const { noteContext } = await import('../../src/lib/notesAi.js');
  const n = await notes.createNote(USER_ID, { title: 'Выписка', body: '' });
  const a = await storeAttachment(db.pool, USER_ID, n.eventId, Buffer.concat([PDF, Buffer.from('scan')]), 'application/pdf', 'scan.pdf');
  const fetchScan = async () => new Response(JSON.stringify({ pages: 2, chars: 0, text: '' }), { status: 200 });
  const noModel = async () => { throw new Error('the file must not go to the model'); };
  let seen = null;
  const ocr = async (f) => { seen = f; return { text: 'Выписка из истории болезни\nДиагноз: тестовый', pages: 2, chars: 40 }; };
  const x = await ex.extractAttachment(USER_ID, n.id, a.sha256, { mode: 'auto', fetchImpl: fetchScan, sees: () => false, ocr, chat: noModel });
  assert.equal(x.method, 'ocr');
  assert.equal(seen.mimeType, 'application/pdf');
  const ctx = await noteContext(USER_ID, n.id);
  assert.match(ctx.text, /ТЕКСТ ПРИЛОЖЕННОГО ФАЙЛА «scan\.pdf» \(распознан со скана \(OCR\), возможны ошибки в символах\)\nВыписка из истории болезни/);
  // «Достать текст» recognises here even when the model could read the scan itself
  const y = await ex.extractAttachment(USER_ID, n.id, a.sha256, { mode: 'ocr', fetchImpl: fetchScan, sees: () => true, ocr, chat: noModel });
  assert.equal(y.method, 'ocr');
  // a photo too, and nothing recognised is an error, not an empty text
  const photo = await storeAttachment(db.pool, USER_ID, n.eventId, Buffer.from('not really a jpeg'), 'image/jpeg', 'photo.jpg');
  await assert.rejects(ex.extractAttachment(USER_ID, n.id, photo.sha256, { mode: 'ocr', ocr: async () => ({ text: '  ', pages: 1, chars: 0 }), chat: noModel }), (e) => e.code === 'bad_output');
});

test('milestone documents: text extracted, present in the profile excerpt, full dossier and sinceContext', { skip: SKIP }, async () => {
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const { extractBySha, extractMeta } = await import('../../src/lib/extracts.js');
  const { buildPatientProfile, buildFullDossier, invalidateProfileCache } = await import('../../src/lib/patientProfile.js');
  const { addEvent } = await import('../../src/lib/feed.js');
  const eventId = await addEvent(db.pool, USER_ID, { type: 'MILESTONE', date: '2026-02-01', title: 'Гистология', meta: { kind: 'histology', tone: 'neutral' }, source: 'test' });
  await db.pool.query(`insert into milestones (user_id, event_id, date, kind, tone, title) values ($1,$2,'2026-02-01','histology','neutral','Гистология №1')`, [USER_ID, eventId]);
  const pdf2 = Buffer.concat([PDF, Buffer.from('histo')]);
  const a = await storeAttachment(db.pool, USER_ID, eventId, pdf2, 'application/pdf', 'histology.pdf');
  await extractBySha(USER_ID, a.sha256, { mode: 'text', fetchImpl: async () => new Response(JSON.stringify({ pages: 1, chars: 900, text: 'Карцинома без уточнения, края резекции чистые.' }), { status: 200 }) });
  assert.equal((await extractMeta(USER_ID, [a.sha256])).get(a.sha256).method, 'pdf_text');
  invalidateProfileCache();
  const profile = await buildPatientProfile(USER_ID);
  assert.match(profile, /Гистология №1\n  документ «histology\.pdf»: Карцинома без уточнения/);
  const full = await buildFullDossier(USER_ID);
  assert.match(full, /ДОКУМЕНТЫ ИЗ ВЕХ[\s\S]*histology\.pdf[\s\S]*края резекции чистые/);
});

test('summary («кратко») is stored next to the full text, inserted as the brief variant, and shown to the AI first', { skip: SKIP }, async () => {
  const notes = await import('../../src/lib/notes.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const ex = await import('../../src/lib/extracts.js');
  const ne = await import('../../src/lib/notesExtract.js');
  const n = await notes.createNote(USER_ID, { title: 'КТ', body: '' });
  const pdf3 = Buffer.concat([PDF, Buffer.from('ct')]);
  const a = await storeAttachment(db.pool, USER_ID, n.eventId, pdf3, 'application/pdf', 'ct.pdf');
  await ex.extractBySha(USER_ID, a.sha256, { mode: 'text', fetchImpl: async () => new Response(JSON.stringify({ pages: 3, chars: 5000, text: 'Длинное заключение КТ … очаг 12 мм … стабилизация.' }), { status: 200 }) });
  const x = await ex.summarizeExtract(USER_ID, a.sha256, { chat: async (args) => { assert.match(args.user, /ТЕКСТ ДОКУМЕНТА\nДлинное заключение/); return { text: 'КТ ОГК: очаг 12 мм, стабилизация.', model: 'stub' }; } });
  assert.equal(x.summary, 'КТ ОГК: очаг 12 мм, стабилизация.');
  assert.equal((await ex.extractMeta(USER_ID, [a.sha256])).get(a.sha256).hasSummary, true);
  const ai = await ex.extractsForAi(USER_ID, [{ sha256: a.sha256, filename: 'ct.pdf' }]);
  assert.match(ai[0].text, /^КРАТКО: КТ ОГК: очаг 12 мм, стабилизация\.\n\nПОЛНЫЙ ТЕКСТ: Длинное/);
  const upd = await ne.insertExtractIntoNote(USER_ID, n.id, a.sha256, { variant: 'summary' });
  assert.match(upd.body, /## Файл: ct\.pdf \(кратко\)\n\nКТ ОГК: очаг 12 мм, стабилизация\./);
});
