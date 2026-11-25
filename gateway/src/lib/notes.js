/** Research notes: markdown notes with tags, links and attached files; imported .md files from other AIs. */
import { pool, transaction } from './db.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { addEvent, updateEvent, deleteEvent } from './feed.js';
import { DEFAULT_TZ, todayKey } from './dates.js';
import { excerptOf } from './notesText.js';

const toNote = (r, files) => ({ id: r.id, eventId: r.event_id, title: r.title, body: r.body, tags: r.tags || [], url: r.url, source: r.source, sourceName: r.source_name, pinned: r.pinned,
  createdAt: r.created_at, updatedAt: r.updated_at, excerpt: r.excerpt, filesCount: r.files_count != null ? Number(r.files_count) : undefined, files });

export { excerptOf, parseMarkdownImport } from './notesText.js';

export async function listNotes(userId, { q, tag, limit = 200 } = {}) {
  const params = [userId]; const where = ['n.user_id = $1'];
  if (q) { params.push(`%${q}%`); where.push(`(n.title ilike $${params.length} or n.body ilike $${params.length} or n.url ilike $${params.length})`); }
  if (tag) { params.push(tag.toLowerCase()); where.push(`$${params.length} = any(n.tags)`); }
  params.push(limit);
  const r = await pool.query(
    `select n.id, n.event_id, n.title, left(n.body, 400) as body, n.tags, n.url, n.source, n.source_name, n.pinned, n.created_at, n.updated_at,
            (select count(*) from attachments a where a.event_id = n.event_id) as files_count
       from notes n where ${where.join(' and ')} order by n.pinned desc, n.updated_at desc limit $${params.length}`, params);
  return r.rows.map((x) => toNote({ ...x, excerpt: excerptOf(x.body) }));
}
export async function listTags(userId) {
  const r = await pool.query('select t as tag, count(*)::int as n from notes, unnest(tags) t where user_id = $1 group by t order by n desc, t', [userId]);
  return r.rows;
}
export async function getNote(userId, id) {
  const r = await pool.query('select * from notes where user_id = $1 and id = $2', [userId, id]);
  const n = r.rows[0];
  if (!n) return null;
  const files = n.event_id ? (await pool.query('select sha256, filename, mime_type as "mimeType", created_at as "createdAt" from attachments where user_id = $1 and event_id = $2 order by created_at', [userId, n.event_id])).rows : [];
  return toNote(n, files);
}
const norm = (x, language) => ({ title: String(x.title || '').trim().slice(0, 200) || t(language, 'feedTitles.noteDefault'), body: String(x.body || ''), tags: [...new Set((x.tags || []).map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 20), url: x.url && /^https?:\/\//i.test(String(x.url).trim()) ? String(x.url).trim().slice(0, 1000) : null });

export async function createNote(userId, x, { tz = DEFAULT_TZ, source = 'manual', sourceName = null, date, transact = transaction } = {}) {
  const language = await userLanguage(userId);
  const v = norm(x, language);
  return transact(async (client) => {
    const eventId = await addEvent(client, userId, { type: 'NOTE', date: date || todayKey(tz), time: '12:00', tz, title: t(language, 'feedTitles.note', { title: v.title }), notes: excerptOf(v.body, 160) || null, meta: { source }, source: 'notes' });
    const r = await client.query('insert into notes (user_id, event_id, title, body, tags, url, source, source_name, pinned) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
      [userId, eventId, v.title, v.body, v.tags, v.url, source, sourceName, Boolean(x.pinned)]);
    return toNote(r.rows[0], []);
  });
}
export async function updateNote(userId, id, x, tz = DEFAULT_TZ) {
  const cur = (await pool.query('select * from notes where user_id = $1 and id = $2', [userId, id])).rows[0];
  if (!cur) return null;
  const language = await userLanguage(userId);
  const v = norm({ title: x.title ?? cur.title, body: x.body ?? cur.body, tags: x.tags ?? cur.tags, url: x.url === undefined ? cur.url : x.url }, language);
  const pinned = x.pinned === undefined ? cur.pinned : Boolean(x.pinned);
  await transaction(async (client) => {
    await client.query('update notes set title=$3, body=$4, tags=$5, url=$6, pinned=$7, updated_at=now() where user_id=$1 and id=$2', [userId, id, v.title, v.body, v.tags, v.url, pinned]);
    if (cur.event_id) await updateEvent(client, userId, cur.event_id, { title: t(language, 'feedTitles.note', { title: v.title }), notes: excerptOf(v.body, 160) || null });
  });
  return getNote(userId, id);
}
export async function deleteNote(userId, id) {
  const r = await pool.query('delete from notes where user_id = $1 and id = $2 returning event_id', [userId, id]);
  if (!r.rows.length) return false;
  if (r.rows[0].event_id) {
    const files = await pool.query('select file_url, sha256 from attachments where user_id = $1 and event_id = $2', [userId, r.rows[0].event_id]);
    await deleteEvent(pool, userId, r.rows[0].event_id);
    const { releaseFile } = await import('./extracts.js');
    for (const f of files.rows) await releaseFile(userId, f.sha256, f.file_url);
  }
  return true;
}

/** Notes text for the AI: pinned first, then the most recent, each trimmed. */
export async function notesForAi(userId, { limit = 10, chars = 1500 } = {}) {
  const r = await pool.query('select title, body, url, tags, source_name, updated_at from notes where user_id = $1 order by pinned desc, updated_at desc limit $2', [userId, limit]);
  return r.rows.map((n) => ({ title: n.title, url: n.url, tags: n.tags, sourceName: n.source_name, updatedAt: n.updated_at, text: String(n.body || '').slice(0, chars) }));
}
