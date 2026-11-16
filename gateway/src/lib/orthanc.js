/**
 * Orthanc: REST client, import of disc folders from DICOM_DIR, linking DICOM studies to imaging_studies.
 * Import runs in the background (one at a time); progress is kept in memory and in dicom_imports.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, transaction } from './db.js';
import { MODALITY_CT, MODALITY_PET_CT } from '../../../shared/medCodes.js';
import { kindLabel, studyTitle } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { modalityGroup } from './recist.js';
import { addEvent } from './feed.js';
import { available } from './edition.js';

export const DICOM_DIR = process.env.DICOM_DIR || '/dicom';
const URL_ = (process.env.ORTHANC_URL || 'http://orthanc:8042').replace(/\/$/, '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.ORTHANC_USER || 'dtc'}:${process.env.ORTHANC_PASSWORD || ''}`).toString('base64');

// On only with both an address and a password: the base stack runs without Orthanc (dicom profile is optional).
/** Orthanc's basic auth, for the edge to put on viewer requests (routes/imaging.js, /orthanc-auth). Never sent to a browser. */
export const orthancAuthHeader = () => AUTH;
export function orthancEnabled() { return available('dicom') && Boolean(process.env.ORTHANC_URL && process.env.ORTHANC_PASSWORD); }

async function api(method, p, body, headers = {}) {
  const r = await fetch(`${URL_}${p}`, { method, headers: { authorization: AUTH, ...headers }, body, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) { const e = new Error(`orthanc ${method} ${p}: ${r.status}`); e.code = 'orthanc'; e.status = r.status; throw e; }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}
export const orthancSystem = () => api('GET', '/system');
export const orthancStudies = () => api('GET', '/studies?expand');
export const orthancStudy = (id) => api('GET', `/studies/${id}`);

/** Folders available for import (top level of DICOM_DIR). */
export async function listFolders() {
  let names = [];
  try { names = (await fs.readdir(DICOM_DIR, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort().reverse(); } catch { return []; }
  const done = await pool.query('select folder, files, imported, studies, finished_at, error from dicom_imports');
  const byFolder = new Map(done.rows.map((r) => [r.folder, r]));
  return names.map((n) => ({ folder: n, import: byFolder.get(n) || null }));
}

async function* walk(dir) {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (/viewer|_files$/i.test(d.name)) continue; yield* walk(p); }
    else yield p;
  }
}
async function isDicom(p) {
  const fh = await fs.open(p, 'r');
  try { const b = Buffer.alloc(132); const { bytesRead } = await fh.read(b, 0, 132, 0); return bytesRead === 132 && b.subarray(128, 132).toString('ascii') === 'DICM'; } finally { await fh.close(); }
}

const jobs = new Map(); // folder -> { status, files, imported, studies, error }
export function importStatus() { return [...jobs.entries()].map(([folder, j]) => ({ folder, ...j })); }

/** Import one folder: every DICOM file is POSTed to /instances (Orthanc deduplicates). Then link studies. */
export async function importFolder(userId, folder, log = console) {
  if (!/^[^/\\]+$/.test(folder) || folder === '.' || folder === '..' || folder.startsWith('.')) throw Object.assign(new Error('bad folder'), { code: 'bad_folder' });
  const dirReal = path.resolve(DICOM_DIR, folder);
  if (!dirReal.startsWith(path.resolve(DICOM_DIR) + path.sep)) throw Object.assign(new Error('bad folder'), { code: 'bad_folder' });
  if ([...jobs.values()].some((j) => j.status === 'running')) throw Object.assign(new Error('import already running'), { code: 'busy' });
  const dir = path.join(DICOM_DIR, folder);
  await fs.access(dir);
  const job = { status: 'running', files: 0, imported: 0, studies: [], error: null, startedAt: new Date().toISOString() };
  jobs.set(folder, job);
  await pool.query('insert into dicom_imports (user_id, folder) values ($1,$2) on conflict (user_id, folder) do update set started_at = now(), finished_at = null, error = null, files = 0, imported = 0', [userId, folder]);
  (async () => {
    try {
      const studyIds = new Set();
      for await (const p of walk(dir)) {
        job.files++;
        if (!(await isDicom(p))) continue;
        const buf = await fs.readFile(p);
        try {
          const r = await api('POST', '/instances', buf, { 'content-type': 'application/dicom' });
          if (r?.ParentStudy) studyIds.add(r.ParentStudy);
          job.imported++;
        } catch (e) { log.warn({ file: p, err: e.message }, 'orthanc import: file failed'); }
      }
      slicesCache.clear();
      job.studies = await linkStudies(userId, [...studyIds], folder);
      job.status = 'done';
      await pool.query('update dicom_imports set files = $3, imported = $4, studies = $5, finished_at = now() where user_id = $1 and folder = $2', [userId, folder, job.files, job.imported, JSON.stringify(job.studies)]);
      log.info({ folder, files: job.files, imported: job.imported, studies: job.studies.length }, 'orthanc import done');
    } catch (e) {
      job.status = 'error'; job.error = e.message;
      await pool.query('update dicom_imports set error = $3, finished_at = now() where user_id = $1 and folder = $2', [userId, folder, e.message]).catch(() => {});
      log.error({ folder, err: e.message }, 'orthanc import failed');
    }
  })();
  return job;
}

// stored values, shared/medCodes.js
const MOD_RU = { CT: MODALITY_CT, MR: 'МРТ', PT: MODALITY_PET_CT, US: 'УЗИ', CR: 'Рентген', DX: 'Рентген', NM: 'Сцинтиграфия' };
// DICOM BodyPartExamined → locales/<language>/server/feedTitles.json, region.*
const REGION_KEYS = { CHEST: 'chest', HEAD: 'head', NECK: 'neck', HEADNECK: 'headNeck', ABDOMEN: 'abdomen', PELVIS: 'pelvis', WHOLEBODY: 'wholeBody', SKULL: 'head', 'HEAD NECK': 'headNeck' };

/** Match Orthanc studies to imaging_studies by date and modality group; create records for unknown ones. */
export async function linkStudies(userId, orthancIds, folder) {
  const out = [];
  const language = await userLanguage(userId);
  for (const oid of orthancIds) {
    const st = await orthancStudy(oid);
    const tags = st.MainDicomTags || {};
    const date = /^\d{8}$/.test(tags.StudyDate || '') ? `${tags.StudyDate.slice(0, 4)}-${tags.StudyDate.slice(4, 6)}-${tags.StudyDate.slice(6, 8)}` : null;
    const mods = new Set();
    let bodyPart = '';
    for (const sid of st.Series || []) {
      const se = await api('GET', `/series/${sid}`).catch(() => null);
      const m = se?.MainDicomTags?.Modality; if (m) mods.add(m);
      if (!bodyPart && se?.MainDicomTags?.BodyPartExamined) bodyPart = se.MainDicomTags.BodyPartExamined;
    }
    const isPet = mods.has('PT');
    const modality = isPet ? MODALITY_PET_CT : MOD_RU[[...mods][0]] || [...mods][0] || MODALITY_CT;
    const regionKey = isPet ? 'wholeBody' : REGION_KEYS[String(bodyPart).toUpperCase()];
    const region = regionKey ? t(language, `feedTitles.region.${regionKey}`) : (tags.StudyDescription || '').trim() || null;
    const uid = tags.StudyInstanceUID || null;
    let row = null;
    if (uid) row = (await pool.query('select id from imaging_studies where user_id = $1 and study_instance_uid = $2', [userId, uid])).rows[0];
    if (!row && date) {
      const cands = (await pool.query('select id, modality, orthanc_study_id from imaging_studies where user_id = $1 and study_date = $2::date order by created_at', [userId, date])).rows;
      row = cands.find((c) => modalityGroup(c.modality) === modalityGroup(modality) && !c.orthanc_study_id) || cands.find((c) => modalityGroup(c.modality) === modalityGroup(modality)) || null;
    }
    if (row) {
      await pool.query('update imaging_studies set orthanc_study_id = $2, study_instance_uid = $3, dicom_path = coalesce(dicom_path, $4) where id = $1', [row.id, oid, uid, folder]);
      out.push({ orthancId: oid, studyId: row.id, date, modality, linked: 'existing' });
    } else if (date) {
      const studyId = await transaction(async (c) => {
        const title = studyTitle({ modality, region }, language);
        const notes = t(language, 'feedTitles.imagesImported', { folder });
        const evId = await addEvent(c, userId, { type: 'MILESTONE', date, title: `${kindLabel('imaging', language)}: ${title}`, notes, meta: { kind: 'imaging', tone: 'neutral' }, source: 'imaging' });
        const m = await c.query(`insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,$3,'imaging','neutral',$4,$5) returning id`, [userId, evId, date, title, notes]);
        const s = await c.query(`insert into imaging_studies (user_id, modality, body_region, performed_at, study_date, dicom_path, milestone_id, orthanc_study_id, study_instance_uid)
                                 values ($1,$2,$3,($4::date || ' 12:00')::timestamp at time zone 'Europe/Moscow',$4,$5,$6,$7,$8) returning id`, [userId, modality, region, date, folder, m.rows[0].id, oid, uid]);
        return s.rows[0].id;
      });
      out.push({ orthancId: oid, studyId, date, modality, linked: 'created' });
    } else out.push({ orthancId: oid, studyId: null, date, modality, linked: 'no_date' });
  }
  return out;
}

// ---- slices: series of a study, ordered slices, rendered frames ----
const WINDOWS = { lung: [-600, 1500], soft: [40, 400], bone: [300, 1500], brain: [40, 80], auto: null };

export async function studySeries(orthancStudyId) {
  const st = await orthancStudy(orthancStudyId);
  const out = [];
  for (const sid of st.Series || []) {
    const se = await api('GET', `/series/${sid}`);
    const t = se.MainDicomTags || {};
    out.push({ id: sid, number: t.SeriesNumber ? Number(t.SeriesNumber) : null, description: t.SeriesDescription || '', modality: t.Modality || '', count: (se.Instances || []).length, bodyPart: t.BodyPartExamined || '' });
  }
  return out.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
}

const slicesCache = new Map(); // seriesId -> [{ instance, frame }]
export async function orderedSlices(seriesId) {
  if (slicesCache.has(seriesId)) return slicesCache.get(seriesId);
  const r = await api('GET', `/series/${seriesId}/ordered-slices`);
  // SlicesShort: [[instanceId, frameIndex, frameCount], ...] sorted along the slice normal, which for axial
  // series runs feet → head. Reverse so that index 0 is the top of the body and the slider goes downwards.
  const list = (r.SlicesShort || []).map((x) => ({ instance: x[0], frame: x[1] || 0 })).reverse();
  slicesCache.set(seriesId, list);
  return list;
}

/** PNG of one slice with a window preset. */
export async function renderSlice(seriesId, index, { window = 'auto', width = 800 } = {}) {
  const slices = await orderedSlices(seriesId);
  if (!slices.length) throw Object.assign(new Error('no slices'), { code: 'no_slices' });
  const i = Math.min(Math.max(0, Number(index) || 0), slices.length - 1);
  const s = slices[i];
  const w = WINDOWS[window] === undefined ? null : WINDOWS[window];
  const q = new URLSearchParams({ width: String(width), smooth: 'true' });
  if (w) { q.set('window-center', String(w[0])); q.set('window-width', String(w[1])); }
  const r = await fetch(`${URL_}/instances/${s.instance}/frames/${s.frame}/rendered?${q}`, { headers: { authorization: AUTH, accept: 'image/png' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw Object.assign(new Error(`orthanc render ${r.status}`), { code: 'orthanc' });
  return { png: Buffer.from(await r.arrayBuffer()), index: i, total: slices.length, instance: s.instance };
}
export const WINDOW_PRESETS = Object.keys(WINDOWS);
