/**
 * Follow-up questions about a record the AI already commented on. Context = patient
 * profile + the record itself + the latest AI text about it + earlier Q&A in the thread.
 */
import { pool } from './db.js';
import { llmChat } from './llm.js';
import { aiNumber } from './aiFormat.js';
import { patientPrompt } from './aiPrompts.js';
import { buildPatientProfile, aiDay, localYmd } from './patientProfile.js';
import { buildLabDocumentContext, latestComment } from './labsAi.js';
import { buildMonthContext, monthTitle } from './labsMonthly.js';
import { computeRecist, modalityGroup, responseLabel } from './recist.js';
import { modalityLabel, routeLabel } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { displayUnit } from '../../../shared/units.js';
import * as fileStore from './files.js';

export const SUBJECTS = ['lab_document', 'labs_month', 'imaging_study', 'infusions', 'note', 'chat'];

/** What the user is looking at in the app, so «что тут не так?» works. */
async function pageContext(userId, page, language) {
  const p = String(page || '').split('?')[0];
  const id = (rx) => (rx.exec(p) || [])[1];
  const UUID = '([0-9a-f-]{36})';
  try {
    if (id(new RegExp(`^/notes/${UUID}`))) { const { noteContext } = await import('./notesAi.js'); const c = await noteContext(userId, id(new RegExp(`^/notes/${UUID}`)), language); if (c) return `${c.title}\n${c.text.slice(0, 20000)}`; }
    if (id(new RegExp(`^/labs/documents/${UUID}`))) { const c = await buildLabDocumentContext(userId, id(new RegExp(`^/labs/documents/${UUID}`)), language); if (c) return `${t(language, 'aiContext.ask.labDocument', { date: aiDay(c.docDate, language) })}\n${c.text}`; }
  } catch { /* page context is optional */ }
  const NAMES = { '/': 'home', '/labs': 'labs', '/meds': 'meds', '/imaging': 'imaging', '/history': 'history', '/symptoms': 'symptoms', '/infusions': 'infusions', '/consults': 'consults', '/notes': 'notes', '/report': 'report', '/settings': 'settings', '/search': 'search' };
  const key = Object.keys(NAMES).sort((a, b) => b.length - a.length).find((k) => p === k || (k !== '/' && p.startsWith(k)));
  return key ? t(language, 'aiContext.ask.section', { name: t(language, `aiContext.pages.${NAMES[key]}`) }) : '';
}

async function studyContext(userId, studyId, language) {
  const say = (key, args) => t(language, `aiContext.ask.${key}`, args);
  const fmt = (n) => aiNumber(n, 2, language);
  const dateRu = (d) => aiDay(d, language);
  const mm = (v) => t(language, 'aiContext.mm', { v });
  const st = await pool.query('select * from imaging_studies where user_id = $1 and id = $2', [userId, studyId]);
  const s = st.rows[0];
  if (!s) return null;
  const [all, le, me] = await Promise.all([
    pool.query('select id, study_date::text as date, modality, created_at as "createdAt" from imaging_studies where user_id = $1', [userId]),
    pool.query('select id, name, location, is_target, retired from lesions where user_id = $1', [userId]),
    pool.query('select lesion_id, study_id, size_mm, note from lesion_measurements where user_id = $1', [userId]),
  ]);
  const lesions = le.rows.map((l) => ({ id: l.id, name: l.name, location: l.location, isTarget: l.is_target, retired: l.retired }));
  const flat = me.rows.map((m) => ({ studyId: m.study_id, lesionId: m.lesion_id, sizeMm: m.size_mm != null ? Number(m.size_mm) : null }));
  const recist = computeRecist(all.rows, lesions, flat);
  const r = recist.find((x) => x.studyId === s.id);
  const date = s.study_date instanceof Date ? localYmd(s.study_date) : String(s.study_date).slice(0, 10);
  const modality = modalityLabel(s.modality, language);
  const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
  const lines = [say('study', { date: dateRu(date), study: `${modality} ${s.body_region || ''}`, response: s.response ? t(language, 'aiContext.profile.studyResponse', { response: responseLabel(s.response, language) }) : '' })];
  if (s.impression_text) lines.push(say('impression', { text: s.impression_text }));
  const sizes = me.rows.filter((m) => m.study_id === s.id).map((m) => { const l = lesions.find((x) => x.id === m.lesion_id); return `${l?.name || '?'}${l?.location ? ` (${l.location})` : ''}: ${m.size_mm != null ? mm(fmt(m.size_mm)) : say('noSize')}${m.note ? `, ${m.note}` : ''}`; });
  if (sizes.length) lines.push(say('lesionsHere', { list: sizes.join('; ') }));
  if (r) lines.push(say('recist', { sum: fmt(r.sum), response: responseLabel(r.response, language), baseline: signed(r.changeFromBaselinePct), nadir: signed(r.changeFromNadirPct) }));
  // Same lesions on other studies, for trends
  const sameGroup = new Set(all.rows.filter((x) => modalityGroup(x.modality) === modalityGroup(s.modality)).map((x) => x.id));
  const hist = me.rows.filter((m) => m.study_id !== s.id && m.size_mm != null && sameGroup.has(m.study_id)).map((m) => ({ ...m, date: all.rows.find((x) => x.id === m.study_id)?.date })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (hist.length) lines.push(say('sameLesions', { list: hist.map((m) => `${lesions.find((x) => x.id === m.lesion_id)?.name || '?'} ${dateRu(m.date)} ${mm(fmt(m.size_mm))}`).join('; ') }));
  return { title: `${modality} ${dateRu(date)}`, text: lines.join('\n') };
}

async function infusionsContext(userId, language) {
  const say = (key, args) => t(language, `aiContext.ask.${key}`, args);
  const dateRu = (d) => aiDay(d, language);
  const unit = (u) => displayUnit(u, language) || '';
  const { listAgents, listInfusions } = await import('./infusions.js');
  const [agents, items] = await Promise.all([listAgents(userId), listInfusions(userId, { limit: 60 })]);
  const lines = [say('agentsHead')];
  for (const a of agents) lines.push(`• ${a.name}${a.defaultDose != null ? say('agentDose', { dose: a.defaultDose, unit: unit(a.doseUnit) }) : ''}, ${routeLabel(a.route, language)}${a.active ? '' : say('agentHidden')}${a.notes ? `. ${a.notes}` : ''}${a.count ? say('agentSessions', { n: a.count, date: dateRu(a.lastDate) }) : say('agentNoSessions')}`);
  lines.push('', items.length ? say('sessionsHead', { n: items.length }) : say('sessionsNone'));
  for (const x of items) lines.push(`• ${dateRu(x.date)}${x.time ? ` ${x.time}` : ''}: ${x.agentShort || x.agentName}${x.route ? ` (${routeLabel(x.route, language)})` : ''}${x.doseValue != null ? ` ${x.doseValue} ${unit(x.doseUnit)}` : ''}${x.durationMin ? say('sessionMinutes', { n: x.durationMin }) : ''}${x.place ? `, ${x.place}` : ''}${x.notes ? `. ${x.notes}` : ''}${x.reaction ? say('sessionReaction', { text: x.reaction }) : ''}`);
  return { title: say('infusionsTitle'), text: lines.join('\n') };
}

/** { title, text } of a record for the model, in `language` (the user's own when not given). */
export async function subjectContext(userId, subjectType, subjectId, language) {
  const lang = language ?? await userLanguage(userId);
  const say = (key, args) => t(lang, `aiContext.ask.${key}`, args);
  if (subjectType === 'lab_document') {
    const c = await buildLabDocumentContext(userId, subjectId, lang);
    return c ? { title: say('labTitle', { date: aiDay(c.docDate, lang) }), text: c.text } : null;
  }
  if (subjectType === 'labs_month') {
    const c = await buildMonthContext(userId, subjectId, lang);
    return c ? { title: say('monthTitle', { month: monthTitle(subjectId, lang) }), text: c.text } : null;
  }
  if (subjectType === 'imaging_study') return studyContext(userId, subjectId, lang);
  if (subjectType === 'infusions') return infusionsContext(userId, lang);
  if (subjectType === 'note') { const { noteContext } = await import('./notesAi.js'); const c = await noteContext(userId, subjectId, lang); return c ? { title: c.title, text: c.text } : null; }
  if (subjectType === 'chat') return { title: say('chatTitle'), text: '' };
  return null;
}

export async function listQuestions(userId, subjectType, subjectId) {
  const r = await pool.query('select id, question, answer, model, created_at, context from ai_questions where user_id=$1 and subject_type=$2 and subject_id=$3 order by created_at', [userId, subjectType, subjectId]);
  return r.rows;
}

export async function askAboutSubject(userId, subjectType, subjectId, question, { tz, page, deep } = {}) {
  const language = await userLanguage(userId);
  if (subjectType === 'chat') return chat(userId, subjectId, question, { tz, page, deep, language });
  const ctx = await subjectContext(userId, subjectType, subjectId, language);
  if (!ctx) return null;
  const say = (key, args) => t(language, `aiContext.ask.${key}`, args);
  const [profile, prior, last, images] = await Promise.all([
    buildPatientProfile(userId, { tz, language }),
    listQuestions(userId, subjectType, subjectId),
    latestComment(userId, subjectType, subjectId),
    subjectType === 'imaging_study' ? studyImages(userId, subjectId) : subjectType === 'note' ? (await import('./notesAi.js')).noteImages(userId, subjectId) : [],
  ]);
  const parts = [`${say('patientData')}\n${profile}`, `${say('record', { title: ctx.title })}\n${ctx.text}`];
  if (images.length) parts.push(attachedImages(images, language));
  if (last) parts.push(`${say('yourComment')}\n${last.text}`);
  if (prior.length) parts.push(`${say('priorQuestions')}\n` + prior.slice(-8).map((q) => say('priorPair', { question: q.question, answer: q.answer })).join('\n\n'));
  parts.push(`${say('question')}\n${question}`);
  const userText = parts.join('\n\n');
  const out = await llmChat({ system: patientPrompt(language, 'followUp'), user: userText, images, maxTokens: 1200, tier: 'fast', language });
  const answer = out.text.trim();
  if (!answer) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(
    'insert into ai_questions (user_id, subject_type, subject_id, question, answer, model, usage, context) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, question, answer, model, created_at, context',
    [userId, subjectType, subjectId, question, answer, out.model, JSON.stringify(out.usage || {}), `${out.promptTag}\n${userText}`]
  );
  return r.rows[0];
}

/** The line that tells the model which pictures it got. */
export const attachedImages = (images, language) => t(language, 'aiContext.ask.images', { n: images.length, names: images.map((f) => f.name || t(language, 'aiContext.ask.noName')).join('; ') });

/** Free chat from the floating assistant: profile + open page + the thread so far. */
async function chat(userId, threadId, question, { tz, page, deep, language } = {}) {
  const say = (key, args) => t(language, `aiContext.ask.${key}`, args);
  const [profile, prior, pageText] = await Promise.all([buildPatientProfile(userId, { tz, language }), listQuestions(userId, 'chat', threadId), pageContext(userId, page, language)]);
  const parts = [`${say('patientData')}\n${profile}`];
  if (pageText) parts.push(`${say('openPage')}\n${pageText}`);
  if (prior.length) parts.push(`${say('chatBefore')}\n` + prior.slice(-12).map((q) => say('chatPair', { question: q.question, answer: q.answer })).join('\n\n'));
  parts.push(`${say('message')}\n${question}`);
  const userText = parts.join('\n\n');
  const out = await llmChat({ system: patientPrompt(language, 'chat'), user: userText, maxTokens: deep ? 3000 : 1500, tier: deep ? 'main' : 'fast', language });
  const answer = out.text.trim() + (out.truncated ? say('truncated') : '');
  if (!out.text.trim()) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(
    'insert into ai_questions (user_id, subject_type, subject_id, question, answer, model, usage, context) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, question, answer, model, created_at, context',
    [userId, 'chat', threadId, question, answer, out.model, JSON.stringify(out.usage || {}), `${out.promptTag}\n${userText}`]
  );
  return r.rows[0];
}

/** Chat threads, newest first: id, first question, count, last time. */
export async function listChats(userId) {
  const r = await pool.query(`select subject_id as id, count(*)::int as n, max(created_at) as last_at,
      (array_agg(question order by created_at))[1] as title
     from ai_questions where user_id = $1 and subject_type = 'chat' group by subject_id order by max(created_at) desc limit 50`, [userId]);
  return r.rows.map((x) => ({ id: x.id, n: x.n, lastAt: x.last_at, title: String(x.title || '').slice(0, 80) }));
}

/** Image attachments of a study's milestone (saved slices, photos of films), newest last, for multimodal questions. */
export async function studyImages(userId, studyId, limit = 4) {
  const r = await pool.query(
    `select a.file_url, a.mime_type, a.filename from imaging_studies s join milestones m on m.id = s.milestone_id
       join attachments a on a.event_id = m.event_id and a.user_id = s.user_id
      where s.user_id = $1 and s.id = $2 and a.mime_type in ('image/png','image/jpeg','image/webp') order by a.created_at desc limit $3`,
    [userId, studyId, limit]
  );
  const out = [];
  for (const row of r.rows) { try { out.push({ mimeType: row.mime_type, data: await fileStore.read(row.file_url), name: row.filename }); } catch { /* missing file */ } }
  return out.reverse();
}
