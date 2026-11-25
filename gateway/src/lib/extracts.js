/**
 * Text of attached files (any record: notes, milestones, doctor reports), keyed by the file hash.
 * PDF text layer through the ingestion service; for scans and photos a model transcription when the AI service sees
 * images, otherwise text recognition on this machine (ocr.js).
 */
import * as fileStore from './files.js';
import { pool } from './db.js';
import { pdfPlainText } from './pdfEngine.js';
import { llmChat, llmConfig } from './llm.js';
import { ocrFile, pdfLayers, needsPageOcr } from './ocr.js';
import { prompt } from './aiPrompts.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

const meta = (x) => ({ sha256: x.sha256, method: x.method, model: x.model, chars: Number(x.chars ?? x.text?.length ?? 0), createdAt: x.createdAt || x.created_at, hasSummary: Boolean(x.has_summary ?? x.summary), summaryModel: x.summary_model || x.summaryModel || null });

export async function getExtract(userId, sha256) {
  const r = await pool.query('select sha256, method, model, text, summary, summary_model as "summaryModel", created_at as "createdAt" from attachment_extracts where user_id = $1 and sha256 = $2', [userId, sha256]);
  return r.rows[0] || null;
}
/** Metadata for a set of hashes: Map(sha256 -> { method, model, chars, createdAt }). */
export async function extractMeta(userId, shas) {
  if (!shas?.length) return new Map();
  const r = await pool.query('select sha256, method, model, length(text) as chars, (summary is not null) as has_summary, summary_model, created_at as "createdAt" from attachment_extracts where user_id = $1 and sha256 = any($2::text[])', [userId, shas]);
  return new Map(r.rows.map((x) => [x.sha256, meta(x)]));
}
/** Texts for the AI, in the given order, each and the total capped: [{ sha256, filename, method, text }]. */
export async function extractsForAi(userId, files, { each = 8000, total = 40000, language } = {}) {
  const shas = files.map((f) => f.sha256);
  if (!shas.length) return [];
  const r = await pool.query('select sha256, method, text, summary from attachment_extracts where user_id = $1 and sha256 = any($2::text[])', [userId, shas]);
  const byS = new Map(r.rows.map((x) => [x.sha256, x]));
  const out = []; let used = 0;
  for (const f of files) {
    const x = byS.get(f.sha256);
    if (!x) continue;
    const body = x.summary ? t(language, 'aiContext.extractWithSummary', { summary: x.summary.trim(), text: x.text }) : String(x.text);
    const piece = body.slice(0, Math.min(each, Math.max(0, total - used)));
    if (!piece) break;
    used += piece.length;
    out.push({ sha256: f.sha256, filename: f.filename || f.sha256.slice(0, 8), method: x.method, text: piece });
  }
  return out;
}

async function pdfText(buf, filename, fetchImpl = fetch) {
  return pdfPlainText(buf, filename, { fetchImpl });
}

/** Can the configured AI service read this kind of file itself (a scan or a photo)? */
function modelSees(isPdf) {
  const cfg = llmConfig();
  return cfg.enabled && (isPdf ? cfg.caps.pdf : cfg.caps.images);
}

/**
 * Extract the text of the user's attachment with this hash. mode: 'auto' (text layer; for a scan or a photo the model
 * when it sees images, otherwise recognition here), 'text' (text layer only), 'ocr' (text layer, otherwise recognition
 * here, nothing leaves the computer), 'llm' (model transcription, also for images; recognition here when the service
 * cannot see images).
 */
export async function extractBySha(userId, sha256, { mode = 'auto', fetchImpl = fetch, chat = llmChat, ocr = ocrFile, sees = modelSees } = {}) {
  const a = await pool.query('select file_url, mime_type, filename from attachments where user_id = $1 and sha256 = $2 limit 1', [userId, sha256]);
  const f = a.rows[0];
  if (!f) return null;
  const buf = await fileStore.read(f.file_url);
  let method = 'pdf_text', model = null, text = '';
  const isPdf = f.mime_type === 'application/pdf';
  let layers;
  if (isPdf && mode !== 'llm') {
    const r = await pdfText(buf, f.filename, fetchImpl);
    text = r.text || '';
    layers = pdfLayers(r) || [];
    const scanned = needsPageOcr(r);
    if (scanned && (mode === 'auto' || mode === 'ocr')) text = '';
    if (scanned && mode === 'text' && (!r.pages || r.chars / r.pages < 80 || layers.some((s) => !s.trim()))) { const e = new Error('no text layer'); e.code = 'no_text_layer'; throw e; }
  }
  if (!isPdf && mode === 'text') { const e = new Error('not a pdf'); e.code = 'no_text_layer'; throw e; }
  if (!text && (mode === 'ocr' || (mode === 'auto' && !sees(isPdf)) || (mode === 'llm' && llmConfig().enabled && !sees(isPdf)))) {
    text = (await ocr({ mimeType: f.mime_type, data: buf, layers, language: await userLanguage(userId) })).text.trim();
    if (!text) { const e = new Error('Текст не распознан: возможно, это не документ или снимок слишком мелкий'); e.code = 'bad_output'; throw e; }
    method = 'ocr';
  }
  if (!text) {
    if (buf.length > 20 * 1024 * 1024) { const e = new Error('file too big for a model'); e.code = 'too_big'; throw e; }
    const language = await userLanguage(userId);
    const out = await chat({ system: prompt(language, 'transcribeSystem'), user: prompt(language, 'transcribe'), files: isPdf ? [{ mimeType: 'application/pdf', data: buf, name: f.filename }] : [], images: isPdf ? [] : [{ mimeType: f.mime_type, data: buf, name: f.filename }], maxTokens: 12000, tier: 'fast', language });
    text = out.text.trim() + (out.truncated ? t(language, 'aiContext.extractTruncated') : '');
    method = 'llm'; model = out.model;
  }
  if (!text.trim()) { const e = new Error('empty text'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(`insert into attachment_extracts (user_id, sha256, method, model, text) values ($1,$2,$3,$4,$5)
     on conflict (user_id, sha256) do update set method = excluded.method, model = excluded.model, text = excluded.text, created_at = now(), summary = null, summary_model = null, summary_at = null
     returning sha256, method, model, text, created_at as "createdAt"`, [userId, sha256, method, model, text]);
  return { ...r.rows[0], filename: f.filename };
}

/** Short annotation of an attachment's text (extracting the text first when needed). */
export async function summarizeExtract(userId, sha256, { chat = llmChat, fetchImpl = fetch } = {}) {
  let x = await getExtract(userId, sha256);
  if (!x) x = await extractBySha(userId, sha256, { mode: 'auto', fetchImpl, chat });
  if (!x) return null;
  const language = await userLanguage(userId);
  const out = await chat({ system: prompt(language, 'summarizeSystem'), user: `${prompt(language, 'summarize')}\n\n${t(language, 'aiContext.documentText')}\n${String(x.text).slice(0, 60000)}`, maxTokens: 800, tier: 'fast', language });
  const summary = out.text.trim();
  if (!summary) { const e = new Error('empty summary'); e.code = 'bad_output'; throw e; }
  const r = await pool.query('update attachment_extracts set summary = $3, summary_model = $4, summary_at = now() where user_id = $1 and sha256 = $2 returning sha256, method, model, text, summary, summary_model as "summaryModel", created_at as "createdAt"', [userId, sha256, summary, out.model]);
  return r.rows[0];
}

/** After an attachment row is deleted: when no record references this file any more, drop its text and the file itself. */
export async function releaseFile(userId, sha256, fileUrl) {
  const still = await pool.query('select 1 from attachments where user_id = $1 and sha256 = $2 limit 1', [userId, sha256]);
  if (still.rows.length) return false;
  await pool.query('delete from attachment_extracts where user_id = $1 and sha256 = $2', [userId, sha256]);
  const byPath = fileUrl ? await pool.query('select 1 from attachments where file_url = $1 limit 1', [fileUrl]) : { rows: [1] };
  if (!byPath.rows.length) await fileStore.remove(fileUrl).catch(() => {});
  return true;
}

/** Best effort after an upload: the text layer of PDFs, silently skipping scans and failures. */
export async function autoExtract(userId, files, log = console) {
  for (const f of files) {
    if (f.mimeType !== 'application/pdf' && f.mime_type !== 'application/pdf') continue;
    try { await extractBySha(userId, f.sha256, { mode: 'text' }); }
    catch (e) { log.info?.({ err: e.message, sha: f.sha256 }, 'attachment: no text extracted'); }
  }
}

/** Route helper shared by notes and milestones. */
export async function extractOrReply(reply, userId, sha256, mode) {
  try {
    const x = mode === 'summary' ? await summarizeExtract(userId, sha256) : await extractBySha(userId, sha256, { mode });
    return x ? { extract: { ...x, chars: x.text.length, hasSummary: Boolean(x.summary) } } : reply.code(404).send({ error: 'not_found' });
  } catch (e) {
    if (e.code === 'no_text_layer') return reply.code(422).send({ error: 'no_text_layer', message: 'В PDF нет текстового слоя (скан). Нажмите «Достать текст»: скан распознается без ИИ.' });
    if (e.code === 'ocr_failed') return reply.code(422).send({ error: 'ocr_failed', message: 'Не получилось распознать файл' });
    if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
    if (e.code === 'ingestion_failed') return reply.code(502).send({ error: 'ingestion_failed', message: 'Сервис разбора PDF не ответил' });
    if (e.code === 'too_big' || e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
    throw e;
  }
}
