import { llmConfig, llmPing, openrouterModels } from '../lib/llm.js';
import { PROVIDERS, PROVIDER_IDS, validBaseUrl } from '../lib/llmProviders.js';
import { egressPublicIp } from '../lib/egress.js';
import { setSetting, getSetting } from '../lib/settings.js';
import { secretSource, storeSecret } from '../lib/config.js';
import { buildPatientProfile } from '../lib/patientProfile.js';
import { draftAnamnesis } from '../lib/anamnesisAi.js';
import { listVersions, getVersion, saveAnamnesis, restoreVersion } from '../lib/anamnesis.js';
import { SUBJECTS, listQuestions, askAboutSubject } from '../lib/aiAsk.js';
import { commentImagingStudy } from '../lib/imagingAi.js';
import { monthsWithLabs, reviewLabsMonth, monthTitle } from '../lib/labsMonthly.js';
import { pool } from '../lib/db.js';
import { commentLabDocument, latestComment } from '../lib/labsAi.js';
import { UUID_RX } from '../lib/labsQuery.js';
import { userLanguage } from '../lib/userLocale.js';
import { sensitiveConfirmed } from '../lib/auth.js';

/** A proxy URL without its user and password, for the settings screen. */
const maskUrl = (u) => { if (!u) return u; try { const x = new URL(u); if (x.username || x.password) { x.username = '***'; x.password = ''; } return x.toString(); } catch { return '***'; } };

/** Fields of PUT /ai/settings that carry the key of a service. */
const KEY_FIELDS = PROVIDER_IDS.map((id) => PROVIDERS[id].secret);

export default async function aiRoutes(app) {
  app.get('/ai/status', { preHandler: app.authenticate }, async () => {
    const c = llmConfig();
    return {
      provider: c.provider, label: c.label, caps: c.caps, model: c.model, modelSource: c.modelSource, modelFast: c.modelFast, modelFastSource: c.modelFastSource,
      enabled: c.enabled, proxy: maskUrl(c.proxy), customUrl: c.customUrl, folder: c.folder,
      openrouterKeySet: c.keys.openrouter, anthropicKeySet: c.keys.anthropic,
      keySource: Object.fromEntries(PROVIDER_IDS.map((id) => [id, secretSource(PROVIDERS[id].secret)])),
      // what the settings screen offers (llmProviders.js): codes and flags, the interface words them
      providers: PROVIDER_IDS.map((id) => {
        const p = PROVIDERS[id];
        return { id, label: p.label, keySet: c.keys[id], caps: p.caps, needsFolder: Boolean(p.needsFolder), keyOptional: Boolean(p.keyOptional), keyUrl: p.keyUrl || null, note: p.note || null, models: p.models };
      }),
    };
  });
  // Model and provider chosen in the UI; empty value returns to .env / default.
  // Every field is checked first, then everything is written, so a bad field leaves nothing half saved. A change of
  // the service, its address, a key or the Yandex folder decides where the patient's data is sent: it needs the
  // password (or a session that typed it minutes ago, lib/auth.js sensitiveConfirmed). Model names and the anamnesis
  // do not, and neither does sending the service or the address that is already set.
  app.put('/ai/settings', { preHandler: app.authenticate }, async (req, reply) => {
    const body = req.body || {};
    const bad = (error, status = 400) => reply.code(status).send({ error });
    const next = {};
    for (const field of ['model', 'modelFast']) {
      if (!(field in body)) continue;
      const m = String(body[field] || '').trim();
      if (m.length > 120 || /\s/.test(m)) return bad('bad_model');
      next[field] = m;
    }
    if ('anamnesis' in body) {
      next.anamnesis = String(body.anamnesis || '').trim();
      if (next.anamnesis.length > 20000) return bad('too_long');
    }
    // API keys from the settings page (app_settings); keys in .env win and cannot be changed here.
    const keys = {};
    for (const name of KEY_FIELDS) {
      if (!(name in body)) continue;
      if (secretSource(name) === 'env') return bad('set_in_env', 409);
      const k = String(body[name] || '').trim();
      if (k.length > 300 || /\s/.test(k)) return bad('bad_key');
      keys[name] = k;
    }
    if ('baseUrl' in body) {
      const raw = String(body.baseUrl || '').trim();
      next.baseUrl = raw ? validBaseUrl(raw) : '';
      if (next.baseUrl === null || raw.length > 300) return bad('bad_base_url');
    }
    if ('yandexFolder' in body) {
      next.yandexFolder = String(body.yandexFolder || '').trim();
      if (next.yandexFolder && !/^[a-z0-9]{1,64}$/i.test(next.yandexFolder)) return bad('bad_folder');
    }
    if ('provider' in body) {
      const p = String(body.provider || '').trim().toLowerCase();
      if (!['', 'auto', ...PROVIDER_IDS].includes(p)) return bad('bad_provider');
      next.provider = p === 'auto' ? '' : p;
    }

    // A key in the request always counts (comparing it with the stored one would tell a guess from the key), except
    // removing a key that is not there; the rest counts when it differs from what is set.
    const sensitive = Object.entries(keys).some(([name, k]) => k || secretSource(name))
      || ('baseUrl' in next && next.baseUrl !== (getSetting('llm_base_url') || ''))
      || ('yandexFolder' in next && next.yandexFolder !== (getSetting('llm_yandex_folder') || ''))
      || ('provider' in next && next.provider !== (getSetting('llm_provider') || ''));
    if (sensitive && !(await sensitiveConfirmed(req, reply))) return reply;

    if ('model' in next) await setSetting('llm_model', next.model);
    if ('modelFast' in next) await setSetting('llm_model_fast', next.modelFast);
    if ('anamnesis' in next) await saveAnamnesis(req.user.sub, next.anamnesis, { source: body.source === 'ai_draft' ? 'ai_draft' : 'manual', note: body.note ? String(body.note).slice(0, 200) : null });
    for (const [name, k] of Object.entries(keys)) await storeSecret(name, k);
    if ('baseUrl' in next) await setSetting('llm_base_url', next.baseUrl);
    if ('yandexFolder' in next) await setSetting('llm_yandex_folder', next.yandexFolder);
    if ('provider' in next) {
      // another service: its own default models, unless this request sets them
      if (next.provider !== (getSetting('llm_provider') || '') && llmConfig().provider !== next.provider) {
        if (!('model' in next)) await setSetting('llm_model', '');
        if (!('modelFast' in next)) await setSetting('llm_model_fast', '');
      }
      await setSetting('llm_provider', next.provider);
    }
    const c = llmConfig();
    return { provider: c.provider, model: c.model, modelSource: c.modelSource, modelFast: c.modelFast, modelFastSource: c.modelFastSource, enabled: c.enabled };
  });
  // Anamnesis history: list, one version with a line diff against the current text, restore.
  app.get('/ai/anamnesis/versions', { preHandler: app.authenticate }, async (req) => ({ versions: await listVersions(req.user.sub) }));
  app.get('/ai/anamnesis/versions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const v = await getVersion(req.user.sub, id);
    return v || reply.code(404).send({ error: 'not_found' });
  });
  app.post('/ai/anamnesis/versions/:id/restore', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const r = await restoreVersion(req.user.sub, id);
    return r ? { ok: true, anamnesis: r.text } : reply.code(404).send({ error: 'not_found' });
  });
  // What the model sees about the patient (anamnesis from settings + data from MedControl)
  app.get('/ai/profile', { preHandler: app.authenticate }, async (req) => {
    return { anamnesis: getSetting('anamnesis') || '', profile: await buildPatientProfile(req.user.sub, { tz: req.user.tz }) };
  });
  // Draft of an updated anamnesis from MedControl data; nothing is saved until the user accepts it (PUT /ai/settings).
  app.post('/ai/anamnesis/draft', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return await draftAnamnesis(req.user.sub, { tz: req.user.tz });
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
  // Follow-up questions about a record
  const validSubject = (t, id) => SUBJECTS.includes(t) && (t === 'labs_month' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(id) : t === 'infusions' ? id === 'all' : UUID_RX.test(id));
  app.get('/ai/questions', { preHandler: app.authenticate }, async (req, reply) => {
    const t = String(req.query?.subject_type || ''), id = String(req.query?.subject_id || '');
    if (!validSubject(t, id)) return reply.code(400).send({ error: 'bad_subject' });
    return { questions: await listQuestions(req.user.sub, t, id) };
  });
  // Delete one question or clear the whole thread of a record
  app.delete('/ai/questions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const r = await pool.query('delete from ai_questions where user_id = $1 and id = $2', [req.user.sub, id]);
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/ai/questions', { preHandler: app.authenticate }, async (req, reply) => {
    const t = String(req.query?.subject_type || ''), id = String(req.query?.subject_id || '');
    if (!validSubject(t, id)) return reply.code(400).send({ error: 'bad_subject' });
    const r = await pool.query('delete from ai_questions where user_id = $1 and subject_type = $2 and subject_id = $3', [req.user.sub, t, id]);
    return { ok: true, deleted: r.rowCount };
  });
  app.get('/ai/chats', { preHandler: app.authenticate }, async (req) => { const { listChats } = await import('../lib/aiAsk.js'); return { chats: await listChats(req.user.sub) }; });
  app.post('/ai/ask', { preHandler: app.authenticate }, async (req, reply) => {
    const t = String(req.body?.subject_type || ''), id = String(req.body?.subject_id || '');
    const question = String(req.body?.question || '').trim();
    if (!validSubject(t, id)) return reply.code(400).send({ error: 'bad_subject' });
    if (!question || question.length > 2000) return reply.code(400).send({ error: 'bad_question' });
    try {
      const page = typeof req.body?.page === 'string' ? req.body.page.slice(0, 200) : undefined;
      const q = await askAboutSubject(req.user.sub, t, id, question, { tz: req.user.tz, page, deep: req.body?.deep === true });
      if (!q) return reply.code(404).send({ error: 'not_found' });
      return { question: q };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
  // Monthly review of all labs
  app.get('/ai/labs-month', { preHandler: app.authenticate }, async (req) => {
    const months = await monthsWithLabs(req.user.sub);
    const reviews = await pool.query(`select distinct on (subject_id) subject_id as ym, id, model, text, created_at, context from ai_comments where user_id = $1 and subject_type = 'labs_month' order by subject_id, created_at desc`, [req.user.sub]);
    const byYm = new Map(reviews.rows.map((r) => [r.ym, r]));
    const language = await userLanguage(req.user.sub);
    return { months: months.map((m) => ({ ym: m.ym, title: monthTitle(m.ym, language), results: m.n, review: byYm.get(m.ym) || null })) };
  });
  app.post('/ai/labs-month/:ym', { preHandler: app.authenticate }, async (req, reply) => {
    const ym = String(req.params?.ym || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return reply.code(400).send({ error: 'bad_month' });
    try {
      const r = await reviewLabsMonth(req.user.sub, ym, { tz: req.user.tz });
      if (!r) return reply.code(404).send({ error: 'no_results', message: 'За этот месяц нет анализов' });
      return { review: r };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
  // AI commentary on an imaging study
  app.get('/ai/comments/imaging-study/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    return { comment: await latestComment(req.user.sub, 'imaging_study', id) };
  });
  app.post('/ai/comments/imaging-study/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    try {
      const c = await commentImagingStudy(req.user.sub, id, { tz: req.user.tz });
      if (!c) return reply.code(404).send({ error: 'not_found' });
      return { comment: c };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
  // AI commentary on a lab document
  app.get('/ai/comments/lab-document/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    return { comment: await latestComment(req.user.sub, 'lab_document', id) };
  });
  app.post('/ai/comments/lab-document/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    try {
      const c = await commentLabDocument(req.user.sub, id);
      if (!c) return reply.code(404).send({ error: 'not_found' });
      return { comment: c };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
  // Token usage per month across comments, questions and visit prep (from the stored usage JSON)
  app.get('/ai/usage', { preHandler: app.authenticate }, async (req) => {
    const r = await pool.query(`
      select to_char(created_at, 'YYYY-MM') as ym, count(*)::int as calls,
             sum(coalesce((usage->>'input')::bigint, (usage->>'input_tokens')::bigint, 0))::bigint as input,
             sum(coalesce((usage->>'output')::bigint, (usage->>'output_tokens')::bigint, 0))::bigint as output,
             sum(coalesce((usage->>'cacheRead')::bigint, 0))::bigint as cache_read
        from (select created_at, usage from ai_comments where user_id = $1 union all select created_at, usage from ai_questions where user_id = $1) x
       group by 1 order by 1 desc limit 6`, [req.user.sub]);
    return { months: r.rows.map((x) => ({ ym: x.ym, calls: x.calls, input: Number(x.input), output: Number(x.output), cacheRead: Number(x.cache_read) })) };
  });
  app.post('/ai/ping', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return { ok: true, ...(await llmPing(req.body?.tier === 'fast' ? 'fast' : 'main', await userLanguage(req.user.sub))) };
    } catch (e) {
      const status = e.code === 'no_api_key' ? 503 : 502;
      return reply.code(status).send({ error: e.code || 'provider', message: e.message });
    }
  });
  app.get('/ai/egress', { preHandler: app.authenticate }, async (req, reply) => {
    const c = llmConfig();
    try {
      return { proxy: maskUrl(c.proxy), ip: await egressPublicIp() };
    } catch (e) {
      return reply.code(502).send({ error: 'egress', message: e.message, proxy: maskUrl(c.proxy) });
    }
  });
  app.get('/ai/models', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return { models: await openrouterModels(String(req.query?.q || '')) };
    } catch (e) {
      return reply.code(502).send({ error: 'provider', message: e.message });
    }
  });
}
