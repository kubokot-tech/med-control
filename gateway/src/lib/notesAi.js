/** AI on a research note: how the material relates to this patient's case; stored in ai_comments (subject 'note'). */
import { pool } from './db.js';
import { llmChat } from './llm.js';
import { patientPrompt } from './aiPrompts.js';
import { attachedImages } from './aiAsk.js';
import { buildPatientProfile, aiDay } from './patientProfile.js';
import { getNote } from './notes.js';
import { extractsForAi } from './notesExtract.js';
import { extractMethodLabel } from './extractMethod.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import * as fileStore from './files.js';

export async function noteContext(userId, noteId, language) {
  const n = await getNote(userId, noteId);
  if (!n) return null;
  const say = (key, args) => t(language, `aiContext.notes.${key}`, args);
  const lines = [say('title', { v: n.title })];
  if (n.url) lines.push(say('link', { v: n.url }));
  if (n.tags?.length) lines.push(say('tags', { v: n.tags.join(', ') }));
  if (n.sourceName) lines.push(say('source', { v: n.sourceName }));
  lines.push(say('written', { v: aiDay(n.updatedAt, language) }));
  if (n.files?.length) lines.push(say('files', { v: n.files.map((f) => f.filename || f.mimeType).join('; ') }));
  lines.push('', say('body'), String(n.body || '').slice(0, 14000));
  // whole documents (an NGS report is ~55k chars): cost follows the actual size, small files cost the same as before
  const extracts = await extractsForAi(userId, noteId, { each: 60000, total: 120000, language });
  for (const x of extracts) lines.push('', say('fileText', { file: x.filename, method: extractMethodLabel(x.method, language) }), x.text);
  const missing = (n.files || []).filter((f) => f.mimeType === 'application/pdf' && !extracts.some((x) => x.filename === f.filename));
  if (missing.length) lines.push('', say('noText', { v: missing.map((f) => f.filename).join('; ') }));
  return { title: say('head', { title: n.title }), text: lines.join('\n'), note: n };
}

export async function noteImages(userId, noteId, limit = 4) {
  const r = await pool.query(`select a.file_url, a.mime_type, a.filename from notes n join attachments a on a.event_id = n.event_id and a.user_id = n.user_id
     where n.user_id = $1 and n.id = $2 and a.mime_type in ('image/png','image/jpeg','image/webp') order by a.created_at desc limit $3`, [userId, noteId, limit]);
  const out = [];
  for (const row of r.rows) { try { out.push({ mimeType: row.mime_type, data: await fileStore.read(row.file_url), name: row.filename }); } catch { /* missing */ } }
  return out.reverse();
}

export async function commentNote(userId, noteId, { tz } = {}) {
  const language = await userLanguage(userId);
  const ctx = await noteContext(userId, noteId, language);
  if (!ctx) return null;
  const say = (key, args) => t(language, `aiContext.notes.${key}`, args);
  const [profile, images] = await Promise.all([buildPatientProfile(userId, { tz, language }), noteImages(userId, noteId)]);
  const userText = `${t(language, 'aiContext.ask.patientData')}\n${profile}\n\n${say('section')}\n${ctx.text}${images.length ? `\n\n${attachedImages(images, language)}` : ''}\n\n${say('ask')}`;
  const out = await llmChat({ system: patientPrompt(language, 'notes'), user: userText, images, maxTokens: 3000, tier: 'main', language });
  const text = out.text.trim() + (out.truncated ? t(language, 'aiContext.ask.truncated') : '');
  if (!text) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(
    'insert into ai_comments (user_id, subject_type, subject_id, model, text, usage, context) values ($1,$2,$3,$4,$5,$6,$7) returning id, model, text, usage, created_at, context',
    [userId, 'note', noteId, out.model, text, JSON.stringify(out.usage || {}), `${out.promptTag}\n${userText}`]
  );
  return r.rows[0];
}
