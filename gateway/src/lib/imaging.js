/**
 * Imaging core: studies (each mirrored as an «imaging» milestone with a feed event), target lesions, measurements,
 * RECIST against baseline and nadir, and the AI parse of a radiology report from the study's files or pasted text.
 * The DICOM archive and slices (Orthanc) are server-only and stay in routes/imaging.js.
 * Inputs are validated by the caller; expected failures are CoreError (lib/errors.js).
 */
import { pool, transaction, abort } from './db.js';
import * as fileStore from './files.js';
import { DEFAULT_TZ } from './dates.js';
import { computeRecist, responseLabel, responseLabels } from './recist.js';
import { parseImagingReport } from './llm.js';
import { storeParseComment } from './imagingAi.js';
import { releaseFile } from './extracts.js';
import { addEvent, updateEvent } from './feed.js';
import { notFound } from './errors.js';
import { kindLabel, studyTitle } from './eventText.js';
import { userLanguage } from './userLocale.js';

export const RESPONSES = ['CR', 'PR', 'SD', 'PD', 'NA'];
const toneFor = (r) => (r === 'PR' || r === 'CR' ? 'positive' : r === 'PD' ? 'negative' : 'neutral');

export function toStudy(r, language) {
  return {
    id: r.id,
    milestoneId: r.milestone_id,
    date: typeof r.study_date === 'string' ? r.study_date : new Date(r.study_date).toISOString().slice(0, 10),
    modality: r.modality,
    region: r.body_region,
    impression: r.impression_text,
    response: r.response,
    responseLabel: r.response ? responseLabel(r.response, language) : null,
    dicomPath: r.dicom_path,
    orthancStudyId: r.orthanc_study_id || null,
    studyInstanceUid: r.study_instance_uid || null,
    createdAt: r.created_at,
    attachments: [],
    measurements: {},
  };
}
const toLesion = (l) => ({ id: l.id, name: l.name, location: l.location, isTarget: l.is_target, retired: l.retired });

async function syncMilestone(client, userId, tz, study, language) {
  const title = studyTitle(study, language);
  const eventTitle = `${kindLabel('imaging', language)}: ${title}`;
  const tone = toneFor(study.response);
  if (study.milestoneId) {
    const m = await client.query(
      `update milestones set date=$3, tone=$4, title=$5, notes=$6, updated_at=now() where user_id=$1 and id=$2 returning event_id`,
      [userId, study.milestoneId, study.date, tone, title, study.impression || null]
    );
    const eventId = m.rows[0]?.event_id;
    if (eventId) await updateEvent(client, userId, eventId, { type: 'MILESTONE', date: study.date, tz, title: eventTitle, notes: study.impression || null, meta: { kind: 'imaging', tone } });
    return study.milestoneId;
  }
  const evId = await addEvent(client, userId, { type: 'MILESTONE', date: study.date, tz, title: eventTitle, notes: study.impression || null, meta: { kind: 'imaging', tone }, source: 'imaging' });
  const m = await client.query(
    `insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,$3,'imaging',$4,$5,$6) returning id`,
    [userId, evId, study.date, tone, title, study.impression || null]
  );
  return m.rows[0].id;
}

/** Everything the imaging page shows: studies with files and measurements, lesions, RECIST per study. */
export async function imagingOverview(userId, { language } = {}) {
  const [st, le, me] = await Promise.all([
    pool.query('select * from imaging_studies where user_id = $1 order by study_date desc, created_at desc', [userId]),
    pool.query('select * from lesions where user_id = $1 order by is_target desc, created_at', [userId]),
    pool.query('select lesion_id, study_id, size_mm, note from lesion_measurements where user_id = $1', [userId]),
  ]);
  const studies = st.rows.map((r) => toStudy(r, language));
  const byId = new Map(studies.map((s) => [s.id, s]));
  for (const m of me.rows) {
    const s = byId.get(m.study_id);
    if (s) s.measurements[m.lesion_id] = { sizeMm: m.size_mm != null ? Number(m.size_mm) : null, note: m.note };
  }
  const msIds = studies.map((s) => s.milestoneId).filter(Boolean);
  if (msIds.length) {
    const att = await pool.query(
      `select m.id as milestone_id, a.sha256, a.filename, a.mime_type
       from milestones m join attachments a on a.event_id = m.event_id and a.user_id = m.user_id
       where m.user_id = $1 and m.id = any($2::uuid[]) order by a.created_at`,
      [userId, msIds]
    );
    const byMs = new Map();
    for (const a of att.rows) { if (!byMs.has(a.milestone_id)) byMs.set(a.milestone_id, []); byMs.get(a.milestone_id).push({ sha256: a.sha256, filename: a.filename, mimeType: a.mime_type }); }
    for (const s of studies) s.attachments = byMs.get(s.milestoneId) || [];
  }
  const lesions = le.rows.map(toLesion);
  const flat = me.rows.map((m) => ({ studyId: m.study_id, lesionId: m.lesion_id, sizeMm: m.size_mm != null ? Number(m.size_mm) : null }));
  const recist = computeRecist(studies, lesions, flat).map((r) => ({ ...r, responseLabel: responseLabel(r.response, language) }));
  return { studies, lesions, recist, responses: responseLabels(language) };
}

export async function createStudy(userId, data, { tz = DEFAULT_TZ } = {}) {
  const s = { ...data, milestoneId: null };
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const milestoneId = await syncMilestone(client, userId, tz, s, language);
    const r = await client.query(
      `insert into imaging_studies (user_id, modality, body_region, performed_at, impression_text, study_date, response, dicom_path, milestone_id)
       values ($1,$2,$3,($4::date || ' 12:00')::timestamp at time zone $5,$6,$4,$7,$8,$9) returning *`,
      [userId, s.modality, s.region || null, s.date, tz, s.impression || null, s.response || null, s.dicomPath || null, milestoneId]
    );
    return toStudy(r.rows[0], language);
  });
}

export async function updateStudy(userId, id, patch, { tz = DEFAULT_TZ } = {}) {
  const cur = await pool.query('select * from imaging_studies where user_id = $1 and id = $2', [userId, id]);
  if (!cur.rows.length) throw notFound();
  const s = { ...toStudy(cur.rows[0]), ...patch };
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const milestoneId = await syncMilestone(client, userId, tz, s, language);
    const r = await client.query(
      `update imaging_studies set modality=$3, body_region=$4, performed_at=($5::date || ' 12:00')::timestamp at time zone $6, study_date=$5,
         impression_text=$7, response=$8, dicom_path=$9, milestone_id=$10, updated_at=now()
       where user_id=$1 and id=$2 returning *`,
      [userId, id, s.modality, s.region || null, s.date, tz, s.impression || null, s.response || null, s.dicomPath || null, milestoneId]
    );
    return toStudy(r.rows[0], language);
  });
}

/** Delete a study with its milestone, feed event and files (a file shared with another record stays). */
export async function deleteStudy(userId, id) {
  const released = await transaction(async (client) => {
    const del = await client.query('delete from imaging_studies where user_id = $1 and id = $2 returning milestone_id', [userId, id]);
    if (!del.rows.length) abort(null);
    const msId = del.rows[0].milestone_id;
    if (!msId) return [];
    const ms = await client.query('delete from milestones where user_id = $1 and id = $2 returning event_id', [userId, msId]);
    const eventId = ms.rows[0]?.event_id;
    if (!eventId) return [];
    const att = await client.query('delete from attachments where user_id = $1 and event_id = $2 returning file_url, sha256', [userId, eventId]);
    await client.query('delete from events where user_id = $1 and id = $2', [userId, eventId]);
    return att.rows;
  });
  if (!released) throw notFound();
  for (const f of released) await releaseFile(userId, f.sha256, f.file_url);
}

export async function createLesion(userId, { name, location, isTarget }) {
  const r = await pool.query('insert into lesions (user_id, name, location, is_target) values ($1,$2,$3,$4) returning *', [userId, name, location || null, isTarget ?? true]);
  return toLesion(r.rows[0]);
}

export async function updateLesion(userId, id, p) {
  const cur = await pool.query('select * from lesions where user_id = $1 and id = $2', [userId, id]);
  if (!cur.rows.length) throw notFound();
  const c = cur.rows[0];
  const r = await pool.query(
    'update lesions set name=$3, location=$4, is_target=$5, retired=$6 where user_id=$1 and id=$2 returning *',
    [userId, id, p.name ?? c.name, p.location === undefined ? c.location : p.location, p.isTarget ?? c.is_target, p.retired ?? c.retired]
  );
  return toLesion(r.rows[0]);
}

export async function deleteLesion(userId, id) {
  const r = await pool.query('delete from lesions where user_id = $1 and id = $2 returning id', [userId, id]);
  if (!r.rows.length) throw notFound();
}

/** Upsert sizes for one study; an entry without size and note removes that lesion's measurement. */
export async function saveMeasurements(userId, studyId, measurements) {
  const st = await pool.query('select id from imaging_studies where user_id = $1 and id = $2', [userId, studyId]);
  if (!st.rows.length) throw notFound();
  await transaction(async (client) => {
    for (const m of measurements) {
      if (m.sizeMm == null && !m.note) {
        await client.query('delete from lesion_measurements where user_id = $1 and study_id = $2 and lesion_id = $3', [userId, studyId, m.lesionId]);
      } else {
        await client.query(
          `insert into lesion_measurements (user_id, lesion_id, study_id, size_mm, note) values ($1,$2,$3,$4,$5)
           on conflict (lesion_id, study_id) do update set size_mm = excluded.size_mm, note = excluded.note`,
          [userId, m.lesionId, studyId, m.sizeMm, m.note || null]
        );
      }
    }
  });
}

/**
 * Structure the radiology report with the model, from the study's attached PDFs and images and/or pasted text,
 * and store it as the study's AI comment. Model errors keep their codes (no_api_key, provider, empty, refusal, bad_output).
 */
export async function parseStudyReport(userId, id, text = '', { parse = parseImagingReport } = {}) {
  const st = await pool.query('select milestone_id from imaging_studies where user_id = $1 and id = $2', [userId, id]);
  if (!st.rows.length) throw notFound();
  const files = [];
  if (st.rows[0].milestone_id) {
    const att = await pool.query(
      `select a.file_url, a.mime_type from milestones m join attachments a on a.event_id = m.event_id and a.user_id = m.user_id
       where m.user_id = $1 and m.id = $2 order by a.created_at`,
      [userId, st.rows[0].milestone_id]
    );
    for (const a of att.rows) {
      try { files.push({ mimeType: a.mime_type, data: await fileStore.read(a.file_url) }); } catch { /* missing file */ }
    }
  }
  const { report, usage, model } = await parse({ files, text, userId });
  const u = { input: usage?.input_tokens, output: usage?.output_tokens };
  await storeParseComment(userId, id, report, model, u, await userLanguage(userId));
  return { report, model, usage: u };
}
