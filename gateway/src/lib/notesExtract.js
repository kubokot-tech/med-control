/** Notes-specific wrappers over the generic attachment extracts (lib/extracts.js). */
import { pool } from './db.js';
import { extractBySha, getExtract as getBySha, extractMeta, extractsForAi as forAi } from './extracts.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

async function noteFile(userId, noteId, sha256) {
  const r = await pool.query('select a.sha256, a.filename from notes n join attachments a on a.event_id = n.event_id and a.user_id = n.user_id where n.user_id = $1 and n.id = $2 and a.sha256 = $3', [userId, noteId, sha256]);
  return r.rows[0] || null;
}
export async function listExtracts(userId, noteId) {
  const r = await pool.query('select a.sha256 from notes n join attachments a on a.event_id = n.event_id where n.user_id = $1 and n.id = $2', [userId, noteId]);
  return [...(await extractMeta(userId, r.rows.map((x) => x.sha256))).values()];
}
export async function getExtract(userId, noteId, sha256) {
  return (await noteFile(userId, noteId, sha256)) ? getBySha(userId, sha256) : null;
}
export async function extractsForAi(userId, noteId, caps) {
  const r = await pool.query('select a.sha256, a.filename from notes n join attachments a on a.event_id = n.event_id where n.user_id = $1 and n.id = $2 order by a.created_at', [userId, noteId]);
  return forAi(userId, r.rows, caps);
}
export async function extractAttachment(userId, noteId, sha256, opts) {
  return (await noteFile(userId, noteId, sha256)) ? extractBySha(userId, sha256, opts) : null;
}
/** Append the extracted text to the note body as its own section. */
export async function insertExtractIntoNote(userId, noteId, sha256, { variant = 'full' } = {}) {
  const f = await noteFile(userId, noteId, sha256);
  const x = f ? await getBySha(userId, sha256) : null;
  if (!x) return null;
  const { getNote, updateNote } = await import('./notes.js');
  const n = await getNote(userId, noteId);
  if (!n) return null;
  const brief = variant === 'summary' && x.summary;
  const heading = t(await userLanguage(userId), brief ? 'feedTitles.attachedFileBrief' : 'feedTitles.attachedFile', { name: f.filename || sha256.slice(0, 8) });
  return updateNote(userId, noteId, { body: `${n.body.trimEnd()}\n\n## ${heading}\n\n${(brief ? x.summary : x.text).trim()}\n` });
}
