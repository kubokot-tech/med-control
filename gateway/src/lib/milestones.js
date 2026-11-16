/**
 * Milestones core: the medical history (surgery, radiation, histology, imaging, consults, documents), each with a
 * feed event and attached files. Batch upload makes one milestone per file (an imaging one also gets a study).
 * Inputs are validated by the caller (routes/milestones.js); expected failures are CoreError (lib/errors.js).
 */
import { pool, transaction, abort } from './db.js';
import { DEFAULT_TZ } from './dates.js';
import { storeAttachment, detectMime } from './attachmentsStore.js';
import { extractMeta, autoExtract, getExtract, releaseFile } from './extracts.js';
import { addEvent, updateEvent } from './feed.js';
import { notFound } from './errors.js';
import { DEFAULT_LANGUAGE } from '../../../shared/format.js';
import { kindLabel, milestoneTitle } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { MODALITY_CT } from '../../../shared/medCodes.js';

export const KINDS = ['surgery', 'radiation', 'histology', 'imaging', 'consult', 'document', 'other', 'ai_review'];
export const TONES = ['positive', 'negative', 'neutral'];
/** Every kind in words: { surgery: 'Операция', … }. */
export const kindLabels = (language) => Object.fromEntries(KINDS.map((k) => [k, kindLabel(k, language)]));

function toMilestone(row, attachments = [], language = DEFAULT_LANGUAGE) {
  return {
    id: row.id,
    eventId: row.event_id,
    date: typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10),
    kind: row.kind,
    kindLabel: kindLabel(row.kind, language),
    tone: row.tone,
    title: milestoneTitle(row.kind, row.title, language),
    notes: row.notes,
    createdAt: row.created_at,
    attachments: attachments.map((a) => ({ sha256: a.sha256, filename: a.filename, mimeType: a.mime_type, extract: a.extract || null })),
  };
}

async function upsertEvent(client, userId, tz, m, eventId, language) {
  const fields = { type: 'MILESTONE', date: m.date, tz, title: `${kindLabel(m.kind, language)}: ${m.title}`, notes: m.notes || null, meta: { kind: m.kind, tone: m.tone } };
  if (eventId) { await updateEvent(client, userId, eventId, fields); return eventId; }
  return addEvent(client, userId, { ...fields, source: 'milestones' });
}

/** All milestones, newest first, with their files and the state of each file's extracted text; generated titles in `language`. */
export async function listMilestones(userId, { language } = {}) {
  const r = await pool.query('select * from milestones where user_id = $1 order by date desc, created_at desc', [userId]);
  const ids = r.rows.map((x) => x.event_id).filter(Boolean);
  const att = ids.length
    ? await pool.query('select event_id, sha256, filename, mime_type from attachments where user_id = $1 and event_id = any($2::uuid[]) order by created_at', [userId, ids])
    : { rows: [] };
  const ex = await extractMeta(userId, att.rows.map((a) => a.sha256));
  const byEvent = new Map();
  for (const a of att.rows) { if (!byEvent.has(a.event_id)) byEvent.set(a.event_id, []); byEvent.get(a.event_id).push({ ...a, extract: ex.get(a.sha256) || null }); }
  return r.rows.map((row) => toMilestone(row, byEvent.get(row.event_id) || [], language));
}

export async function createMilestone(userId, m, { tz = DEFAULT_TZ } = {}) {
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const eventId = await upsertEvent(client, userId, tz, m, null, language);
    const r = await client.query(
      `insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [userId, eventId, m.date, m.kind, m.tone || 'neutral', m.title, m.notes || null]
    );
    return toMilestone(r.rows[0]);
  });
}

export async function updateMilestone(userId, id, patch, { tz = DEFAULT_TZ } = {}) {
  const cur = await pool.query('select * from milestones where user_id = $1 and id = $2', [userId, id]);
  if (!cur.rows.length) throw notFound();
  const m = { ...toMilestone(cur.rows[0]), ...patch };
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const eventId = await upsertEvent(client, userId, tz, m, cur.rows[0].event_id, language);
    const r = await client.query(
      `update milestones set date=$3, kind=$4, tone=$5, title=$6, notes=$7, event_id=$8, updated_at=now() where user_id=$1 and id=$2 returning *`,
      [userId, id, m.date, m.kind, m.tone, m.title, m.notes ?? null, eventId]
    );
    return toMilestone(r.rows[0]);
  });
}

/** Delete a milestone with its feed event and files (a file shared with another record stays). */
export async function deleteMilestone(userId, id) {
  const files = await transaction(async (client) => {
    const del = await client.query('delete from milestones where user_id = $1 and id = $2 returning event_id', [userId, id]);
    if (!del.rows.length) abort(null);
    const eventId = del.rows[0].event_id;
    if (!eventId) return [];
    const att = await client.query('delete from attachments where user_id = $1 and event_id = $2 returning file_url, sha256', [userId, eventId]);
    await client.query('delete from events where user_id = $1 and id = $2', [userId, eventId]);
    return att.rows;
  });
  if (!files) throw notFound();
  for (const f of files) await releaseFile(userId, f.sha256, f.file_url);
}

/**
 * Batch upload: items [{ meta: { date, kind, title, tone, modality?, region? }, file: { filename, mimetype, buf } }],
 * one milestone per file in its own transaction; a failed file does not stop the others.
 */
export async function createMilestonesBatch(userId, items, { tz = DEFAULT_TZ, log = console } = {}) {
  const results = [];
  const language = await userLanguage(userId);
  for (const { meta: m, file: f } of items) {
    const mime = detectMime(f.mimetype, f.filename);
    if (!f.buf?.length) { results.push({ filename: f.filename, ok: false, error: 'empty_file' }); continue; }
    if (!mime) { results.push({ filename: f.filename, ok: false, error: 'unsupported_type' }); continue; }
    try {
      const { milestoneId, studyId, attachment } = await transaction(async (client) => {
        const eventId = await upsertEvent(client, userId, tz, m, null, language);
        const r = await client.query(
          `insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,$3,$4,$5,$6,null) returning id`,
          [userId, eventId, m.date, m.kind, m.tone || 'neutral', m.title]
        );
        const milestoneId = r.rows[0].id;
        let studyId = null;
        if (m.kind === 'imaging') {
          const st = await client.query(
            `insert into imaging_studies (user_id, modality, body_region, performed_at, study_date, milestone_id)
             values ($1,$2,$3,($4::date || ' 12:00')::timestamp at time zone $5,$4,$6) returning id`,
            [userId, m.modality || MODALITY_CT, m.region || null, m.date, tz, milestoneId]
          );
          studyId = st.rows[0].id;
        }
        const attachment = await storeAttachment(client, userId, eventId, f.buf, mime, f.filename);
        return { milestoneId, studyId, attachment };
      });
      await autoExtract(userId, [attachment], log);
      results.push({ filename: f.filename, ok: true, milestoneId, studyId, attachment });
    } catch (e) {
      log.warn({ err: e.message, filename: f.filename }, 'batch milestone failed');
      results.push({ filename: f.filename, ok: false, error: 'failed' });
    }
  }
  return { ok: results.every((x) => x.ok), created: results.filter((x) => x.ok).length, results };
}

/** Attach a file (mime already checked by the caller) to a milestone and extract its text layer. */
export async function attachToMilestone(userId, id, { buf, mime, filename }, { log = console } = {}) {
  const cur = await pool.query('select event_id from milestones where user_id = $1 and id = $2', [userId, id]);
  if (!cur.rows.length || !cur.rows[0].event_id) throw notFound();
  const attachment = await storeAttachment(pool, userId, cur.rows[0].event_id, buf, mime, filename);
  await autoExtract(userId, [attachment], log);
  return attachment;
}

/** Whether this file is attached to this milestone of the user. */
export async function milestoneHasFile(userId, id, sha256) {
  const r = await pool.query('select 1 from milestones m join attachments a on a.event_id = m.event_id where m.user_id = $1 and m.id = $2 and a.sha256 = $3', [userId, id, sha256]);
  return r.rows.length > 0;
}

/** Append the file's extracted text (or its summary, variant 'summary') to the milestone's notes; returns the notes. */
export async function insertExtractIntoNotes(userId, id, sha256, { variant = 'full' } = {}) {
  if (!(await milestoneHasFile(userId, id, sha256))) throw notFound();
  const x = await getExtract(userId, sha256);
  if (!x) throw notFound();
  const a = await pool.query('select filename from attachments where user_id = $1 and sha256 = $2 limit 1', [userId, sha256]);
  const brief = variant === 'summary' && x.summary;
  const r = await pool.query(`update milestones set notes = coalesce(notes, '') || $3, updated_at = now() where user_id = $1 and id = $2 returning notes`, [userId, id, `\n\n${t(await userLanguage(userId), brief ? 'feedTitles.attachedFileBrief' : 'feedTitles.attachedFile', { name: a.rows[0]?.filename || sha256.slice(0, 8) })}\n${(brief ? x.summary : x.text).trim()}`]);
  return r.rows[0]?.notes;
}

/** Detach a file from a milestone; the file and its text go when nothing else references them. */
export async function removeMilestoneFile(userId, id, sha256) {
  const cur = await pool.query('select event_id from milestones where user_id = $1 and id = $2', [userId, id]);
  if (!cur.rows.length) throw notFound();
  const del = await pool.query('delete from attachments where user_id = $1 and event_id = $2 and sha256 = $3 returning file_url', [userId, cur.rows[0].event_id, sha256]);
  if (!del.rows.length) throw notFound();
  await releaseFile(userId, sha256, del.rows[0].file_url);
}
