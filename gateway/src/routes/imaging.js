import { z } from 'zod';
import { pool } from '../lib/db.js';
import { UUID_RX } from '../lib/labsQuery.js';
import { DEFAULT_TZ } from '../lib/dates.js';
import { llmConfig } from '../lib/llm.js';
import { explainSlice } from '../lib/imagingAi.js';
import { orthancEnabled, orthancAuthHeader, orthancSystem, listFolders, importFolder, importStatus, studySeries, renderSlice, WINDOW_PRESETS } from '../lib/orthanc.js';
import { storeAttachment } from '../lib/attachmentsStore.js';
import { tokenVersion, HARDCODED_USER_ID } from '../lib/auth.js';
import { VIEWER_TTL_S, viewerCookie, viewerTokenFrom } from '../lib/viewerSession.js';
import { RESPONSES, imagingOverview, createStudy, updateStudy, deleteStudy, createLesion, updateLesion, deleteLesion, saveMeasurements, parseStudyReport } from '../lib/imaging.js';
import { modalityLabel } from '../lib/eventText.js';
import { userLanguage } from '../lib/userLocale.js';
import { t } from '../lib/i18n.js';

const StudyBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modality: z.string().min(1).max(40),
  region: z.string().max(120).nullable().optional(),
  impression: z.string().max(6000).nullable().optional(),
  response: z.enum(RESPONSES).nullable().optional(),
  dicomPath: z.string().max(500).nullable().optional(),
});
const LesionBody = z.object({
  name: z.string().min(1).max(120),
  location: z.string().max(200).nullable().optional(),
  isTarget: z.boolean().optional(),
  retired: z.boolean().optional(),
});
const MeasurementsBody = z.object({
  measurements: z.array(z.object({ lesionId: z.string().uuid(), sizeMm: z.number().min(0).max(500).nullable(), note: z.string().max(300).nullable().optional() })),
});

/** HTTP layer for the imaging core (lib/imaging.js); the DICOM archive and slices through Orthanc are server-only and live here. */
export default async function imagingRoutes(app) {
  app.get('/imaging', { preHandler: app.authenticate }, async (req) => ({
    ...(await imagingOverview(req.user.sub, { language: await userLanguage(req.user.sub) })), aiEnabled: llmConfig().enabled, aiModel: llmConfig().model, orthancEnabled: orthancEnabled(),
  }));

  app.post('/imaging/studies', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = StudyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    return { ok: true, study: await createStudy(req.user.sub, parsed.data, { tz: req.user.tz || DEFAULT_TZ }) };
  });

  app.patch('/imaging/studies/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const parsed = StudyBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    return { ok: true, study: await updateStudy(req.user.sub, id, parsed.data, { tz: req.user.tz || DEFAULT_TZ }) };
  });

  app.delete('/imaging/studies/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    await deleteStudy(req.user.sub, id);
    return { ok: true };
  });

  app.post('/imaging/lesions', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = LesionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    return { ok: true, lesion: await createLesion(req.user.sub, parsed.data) };
  });

  app.patch('/imaging/lesions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const parsed = LesionBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    return { ok: true, lesion: await updateLesion(req.user.sub, id, parsed.data) };
  });

  app.delete('/imaging/lesions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    await deleteLesion(req.user.sub, id);
    return { ok: true };
  });

  app.put('/imaging/studies/:id/measurements', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const parsed = MeasurementsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    await saveMeasurements(req.user.sub, id, parsed.data.measurements);
    return { ok: true };
  });

  // Ask the LLM to structure the report: uses the study's attached PDFs/images and/or pasted text.
  app.post('/imaging/studies/:id/parse', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    try {
      return { ok: true, ...(await parseStudyReport(req.user.sub, id, String(req.body?.text || ''))) };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider') return reply.code(502).send({ error: 'provider', message: e.message });
      if (e.code === 'empty') return reply.code(400).send({ error: 'nothing_to_parse', message: 'Приложите заключение (PDF или фото) или вставьте текст' });
      if (e.code === 'refusal' || e.code === 'bad_output') return reply.code(502).send({ error: e.code });
      throw e;
    }
  });

  // DICOM archive (Orthanc): folders on the disc share, import, status
  // The «Снимки» page asks for this while open: a short cookie that lets edge open the viewer (lib/viewerSession.js).
  app.post('/imaging/viewer-session', { preHandler: app.authenticate }, async (req, reply) => {
    if (!orthancEnabled()) return reply.code(404).send({ error: 'not_found' });
    const token = await reply.jwtSign({ sub: req.user.sub, scope: 'viewer', tv: tokenVersion() }, { expiresIn: VIEWER_TTL_S });
    reply.header('set-cookie', viewerCookie(token));
    return { ok: true, ttlSec: VIEWER_TTL_S };
  });
  // Edge only (Caddy forward_auth on /orthanc/*; the frontend proxy refuses this path): 200 with Orthanc's basic auth
  // for edge to pass on, or a page saying to open the images from MedControl again.
  app.get('/orthanc-auth', async (req, reply) => {
    let ok = false;
    try {
      const p = app.jwt.verify(viewerTokenFrom(req.headers.cookie));
      ok = orthancEnabled() && p.scope === 'viewer' && (p.tv || 0) === tokenVersion();
    } catch { ok = false; }
    if (ok) return reply.header('authorization', orthancAuthHeader()).code(200).send('');
    // no session on this page: the language of the installation's single user
    const language = await userLanguage(HARDCODED_USER_ID);
    return reply.code(401).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
      .send(`<!doctype html><meta charset="utf-8"><title>${t(language, 'notify.appName')}</title><p style="font:16px system-ui;margin:2em">${t(language, 'notify.viewerClosed')}</p>`);
  });
  app.get('/imaging/orthanc', { preHandler: app.authenticate }, async () => {
    if (!orthancEnabled()) return { enabled: false, folders: [], jobs: [] };
    let system = null;
    try { system = await orthancSystem(); } catch { system = null; }
    return { enabled: true, up: Boolean(system), version: system?.Version || null, folders: await listFolders(), jobs: importStatus() };
  });
  app.post('/imaging/orthanc/import', { preHandler: app.authenticate }, async (req, reply) => {
    if (!orthancEnabled()) return reply.code(503).send({ error: 'orthanc_disabled' });
    const folder = String(req.body?.folder || '');
    try {
      const job = await importFolder(req.user.sub, folder, req.log);
      return { ok: true, folder, job };
    } catch (e) {
      if (e.code === 'busy') return reply.code(409).send({ error: 'busy', message: 'Импорт уже идёт' });
      if (e.code === 'bad_folder' || e.code === 'ENOENT') return reply.code(404).send({ error: 'folder_not_found' });
      throw e;
    }
  });

  // Slices of a study (through Orthanc): series list, rendered preview, save a slice as an attachment
  async function studyRow(userId, id) {
    const r = await pool.query('select id, milestone_id, orthanc_study_id, study_date::text as study_date, modality from imaging_studies where user_id = $1 and id = $2', [userId, id]);
    return r.rows[0] || null;
  }
  app.get('/imaging/studies/:id/series', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const st = await studyRow(req.user.sub, id);
    if (!st) return reply.code(404).send({ error: 'not_found' });
    if (!st.orthanc_study_id) return reply.code(409).send({ error: 'no_dicom', message: 'Снимки этого исследования не импортированы' });
    try { return { series: await studySeries(st.orthanc_study_id), windows: WINDOW_PRESETS }; }
    catch (e) { return reply.code(502).send({ error: 'orthanc', message: e.message }); }
  });
  app.get('/imaging/studies/:id/slice', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    const series = String(req.query?.series || '');
    if (!UUID_RX.test(id) || !/^[0-9a-f-]{36,}$/.test(series)) return reply.code(400).send({ error: 'bad_id' });
    const st = await studyRow(req.user.sub, id);
    if (!st?.orthanc_study_id) return reply.code(404).send({ error: 'not_found' });
    try {
      const r = await renderSlice(series, req.query?.index, { window: String(req.query?.window || 'auto'), width: Math.min(1600, Number(req.query?.width) || 800) });
      reply.header('content-type', 'image/png').header('x-slice-index', String(r.index)).header('x-slice-total', String(r.total)).header('cache-control', 'private, max-age=3600');
      return reply.send(r.png);
    } catch (e) { return reply.code(502).send({ error: e.code || 'orthanc', message: e.message }); }
  });
  app.post('/imaging/studies/:id/slices', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const { series, index, window = 'auto', label = '' } = req.body || {};
    if (!/^[0-9a-f-]{36,}$/.test(String(series || ''))) return reply.code(400).send({ error: 'bad_series' });
    const st = await studyRow(req.user.sub, id);
    if (!st?.orthanc_study_id) return reply.code(404).send({ error: 'not_found' });
    const ev = st.milestone_id ? await pool.query('select event_id from milestones where id = $1', [st.milestone_id]) : { rows: [] };
    const eventId = ev.rows[0]?.event_id;
    if (!eventId) return reply.code(409).send({ error: 'no_milestone', message: 'У исследования нет вехи для вложений' });
    try {
      const r = await renderSlice(String(series), index, { window: String(window), width: 1024 });
      const safe = String(label).trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '_').slice(0, 40);
      const language = await userLanguage(req.user.sub);
      const filename = `${t(language, 'feedTitles.sliceFile', { date: st.study_date, modality: modalityLabel(st.modality, language), n: r.index + 1, total: r.total, window: String(window) })}${safe ? `_${safe}` : ''}.png`;
      const att = await storeAttachment(pool, req.user.sub, eventId, r.png, 'image/png', filename);
      return { ok: true, attachment: att, index: r.index, total: r.total };
    } catch (e) { return reply.code(502).send({ error: e.code || 'orthanc', message: e.message }); }
  });
  app.post('/imaging/studies/:id/slice/explain', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const { series, index, window = 'auto' } = req.body || {};
    if (!/^[0-9a-f-]{36,}$/.test(String(series || ''))) return reply.code(400).send({ error: 'bad_series' });
    const st = await studyRow(req.user.sub, id);
    if (!st?.orthanc_study_id) return reply.code(404).send({ error: 'not_found' });
    try {
      const r = await renderSlice(String(series), index, { window: String(window), width: 1024 });
      const e = await explainSlice(req.user.sub, id, r.png, { index: r.index, total: r.total, window: String(window), tz: req.user.tz });
      return { ok: true, ...e, index: r.index, total: r.total };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      return reply.code(502).send({ error: e.code || 'provider', message: e.message });
    }
  });
}
