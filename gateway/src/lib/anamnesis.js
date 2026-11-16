/** Anamnesis text with version history: every change is kept, any version can be restored. */
import { pool } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { lineDiff, diffStats } from './textDiff.js';
import { userFormat } from './userLocale.js';
import { t } from './i18n.js';

const toVersion = (r) => ({ id: r.id, createdAt: r.created_at, source: r.source, note: r.note, chars: Number(r.chars), preview: String(r.preview || '').replace(/\s+/g, ' ').slice(0, 120) });

export async function listVersions(userId) {
  const r = await pool.query('select id, created_at, source, note, length(text) as chars, left(text, 160) as preview from anamnesis_versions where user_id = $1 order by created_at desc limit 100', [userId]);
  return r.rows.map(toVersion);
}
export async function getVersion(userId, id) {
  const r = await pool.query('select * from anamnesis_versions where user_id = $1 and id = $2', [userId, id]);
  const v = r.rows[0];
  if (!v) return null;
  const current = getSetting('anamnesis') || '';
  const diff = lineDiff(v.text, current);
  return { ...toVersion({ ...v, chars: v.text.length, preview: v.text }), text: v.text, isCurrent: v.text === current, diff, stats: diffStats(diff) };
}
/** Save new text: settings + a version row when the text actually changed. */
export async function saveAnamnesis(userId, text, { source = 'manual', note = null } = {}) {
  const t = String(text || '').trim();
  const current = (getSetting('anamnesis') || '').trim();
  await setSetting('anamnesis', t);
  if (t === current) return { changed: false };
  const last = await pool.query('select text from anamnesis_versions where user_id = $1 order by created_at desc limit 1', [userId]);
  if (last.rows[0]?.text?.trim() === t) return { changed: true, versioned: false };
  const r = await pool.query('insert into anamnesis_versions (user_id, text, source, note) values ($1, $2, $3, $4) returning id', [userId, t, source, note]);
  return { changed: true, versioned: true, id: r.rows[0].id };
}
export async function restoreVersion(userId, id) {
  const v = await pool.query('select text, created_at from anamnesis_versions where user_id = $1 and id = $2', [userId, id]);
  if (!v.rows.length) return null;
  const f = await userFormat(userId);
  const when = f.date(v.rows[0].created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  await saveAnamnesis(userId, v.rows[0].text, { source: 'restore', note: t(f.language, 'notify.anamnesisRestored', { when }) });
  return { text: v.rows[0].text };
}
