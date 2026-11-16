/** Doctor appointments: CRUD, AI questions for the visit, the doctor's report as a consult milestone. */
import { pool, transaction } from './db.js';
import { kindLabel } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { raw, t } from './i18n.js';
import { llmChat } from './llm.js';
import { aiFormat, aiNumber } from './aiFormat.js';
import { patientPrompt } from './aiPrompts.js';
import { buildPatientProfile, aiDay } from './patientProfile.js';
import { markerName } from './canonical.js';
import { storeAttachment } from './attachmentsStore.js';
import { extractMethodLabel } from './extractMethod.js';
import { DEFAULT_TZ, todayKey } from './dates.js';
import { addEvent } from './feed.js';
import { alertMessage } from './alerts.js';
import { milestoneTitle, modalityLabel } from './eventText.js';
import { responseLabel } from './recist.js';
import { displayUnit } from '../../../shared/units.js';

export function toAppointment(r) {
  return {
    id: r.id, date: r.date, time: r.time, doctor: r.doctor, place: r.place, notes: r.notes, status: r.status,
    questions: r.questions, questionsContext: r.questions_context, questionsModel: r.questions_model, questionsAt: r.questions_at,
    reportMilestoneId: r.report_milestone_id, createdAt: r.created_at,
  };
}

export async function listAppointments(userId) {
  const r = await pool.query('select * from appointments where user_id = $1 order by date desc, created_at desc', [userId]);
  return r.rows.map(toAppointment);
}
export async function getAppointment(userId, id) {
  const r = await pool.query('select * from appointments where user_id = $1 and id = $2', [userId, id]);
  return r.rows[0] ? toAppointment(r.rows[0]) : null;
}
export async function createAppointment(userId, a) {
  const r = await pool.query(
    'insert into appointments (user_id, date, time, doctor, place, notes) values ($1,$2,$3,$4,$5,$6) returning *',
    [userId, a.date, a.time || null, a.doctor || null, a.place || null, a.notes || null]
  );
  return toAppointment(r.rows[0]);
}
export async function updateAppointment(userId, id, a) {
  // Only keys present in the body are written; null clears the field.
  const cols = { date: 'date', time: 'time', doctor: 'doctor', place: 'place', notes: 'notes', status: 'status' };
  const sets = []; const vals = [userId, id];
  for (const [k, col] of Object.entries(cols)) if (k in a && a[k] !== undefined) { vals.push(a[k]); sets.push(`${col} = $${vals.length}`); }
  if (!sets.length) return getAppointment(userId, id);
  const r = await pool.query(`update appointments set ${sets.join(', ')}, updated_at = now() where user_id = $1 and id = $2 returning *`, vals);
  return r.rows[0] ? toAppointment(r.rows[0]) : null;
}
export async function deleteAppointment(userId, id) {
  const r = await pool.query('delete from appointments where user_id = $1 and id = $2', [userId, id]);
  return r.rowCount > 0;
}

/** Next planned appointment on or after today, and planned ones already in the past without a report. */
export async function upcoming(userId, tz = DEFAULT_TZ) {
  const today = todayKey(tz);
  const r = await pool.query(`select * from appointments where user_id = $1 and status = 'planned' order by date`, [userId]);
  const all = r.rows.map(toAppointment);
  const next = all.find((a) => a.date >= today) || null;
  const overdue = all.filter((a) => a.date < today);
  return { next, overdue, planned: all.filter((a) => a.date >= today), today };
}

/** Data accumulated since the previous completed appointment (or 90 days). */
async function sinceContext(userId, appt, language) {
  const say = (key, args) => t(language, `aiContext.visit.${key}`, args);
  const fmt = (n) => aiNumber(n, 3, language);
  const dateRu = (d) => aiDay(d, language);
  const unit = (u) => displayUnit(u, language) || '';
  const noteDash = raw(language, 'aiContext.noteSeparator');
  const prev = await pool.query(`select date from appointments where user_id = $1 and status = 'done' and date < $2 order by date desc limit 1`, [userId, appt.date]);
  const sinceDate = prev.rows[0]?.date || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [docs, results, ms, studies, reviews, comments, alerts] = await Promise.all([
    pool.query(`select doc_date::text as doc_date, lab_name from ingest_documents where user_id = $1 and doc_date >= $2::date order by doc_date`, [userId, sinceDate]),
    pool.query(`select t.canonical_key as key, t.code, t.category, r.collected_at, r.value_numeric, r.unit_canonical as unit, r.ref_low, r.ref_high
                  from lab_results_eff r join lab_tests t on t.id = r.test_id
                 where r.user_id = $1 and r.collected_at >= $2::date and r.value_numeric is not null order by r.collected_at, t.canonical_key`, [userId, sinceDate]),
    pool.query(`select date::text as date, kind, title, notes from milestones where user_id = $1 and date >= $2::date and kind <> 'ai_review' order by date`, [userId, sinceDate]),
    pool.query(`select study_date::text as date, modality, body_region, response, impression_text from imaging_studies where user_id = $1 and study_date >= $2::date order by study_date`, [userId, sinceDate]),
    pool.query(`select subject_id as ym, text from ai_comments where user_id = $1 and subject_type = 'labs_month' and subject_id >= $2 order by subject_id desc, created_at desc limit 3`, [userId, sinceDate.slice(0, 7)]),
    pool.query(`select c.subject_type, c.subject_id, c.text from ai_comments c where c.user_id = $1 and c.subject_type in ('lab_document','imaging_study') and c.created_at >= $2::date order by c.created_at desc limit 6`, [userId, sinceDate]),
    pool.query(`select triggered_at, status, context from alerts where user_id = $1 and triggered_at >= $2::date order by triggered_at desc limit 15`, [userId, sinceDate]),
  ]);
  const lines = [say('period', { from: dateRu(sinceDate), to: dateRu(appt.date), basis: say(prev.rows[0] ? 'sinceLast' : 'noLast') })];
  const { extractsForAi } = await import('./extracts.js');
  const docFiles = await pool.query(`select a.sha256, a.filename, m.date::text as date, m.title from milestones m join attachments a on a.event_id = m.event_id
     where m.user_id = $1 and m.date >= $2::date and m.kind <> 'ai_review' order by m.date, a.created_at`, [userId, sinceDate]);
  const docTexts = await extractsForAi(userId, docFiles.rows, { each: 6000, total: 30000, language });
  lines.push(say('appointment', { date: `${dateRu(appt.date)}${appt.time ? ` ${appt.time}` : ''}${appt.doctor ? `, ${appt.doctor}` : ''}${appt.place ? `, ${appt.place}` : ''}`, note: appt.notes ? say('appointmentNote', { text: appt.notes }) : '' }));
  if (docs.rows.length) lines.push(say('labs', { n: docs.rows.length, labs: [...new Set(docs.rows.map((d) => d.lab_name).filter(Boolean))].join(', '), dates: [...new Set(docs.rows.map((d) => dateRu(d.doc_date)))].join(', ') }));
  const flagged = results.rows.filter((r) => (r.ref_high != null && Number(r.value_numeric) > Number(r.ref_high)) || (r.ref_low != null && Number(r.value_numeric) < Number(r.ref_low)));
  if (flagged.length) {
    lines.push(say('flagged'));
    for (const r of flagged) lines.push(`• ${dateRu(r.collected_at)} ${(r.key ? markerName(r.key, language) : '') || r.code}${r.category === 'urine' ? t(language, 'aiContext.urine') : ''}: ${fmt(r.value_numeric)} ${unit(r.unit)}${t(language, 'aiContext.reference', { ref: `${fmt(r.ref_low)}–${fmt(r.ref_high)}` })}`);
  }
  const byKey = new Map();
  for (const r of results.rows) { if (!r.key) continue; if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  const trends = [...byKey].filter(([, xs]) => xs.length >= 2).slice(0, 25);
  if (trends.length) {
    lines.push(say('trends'));
    for (const [k, xs] of trends) lines.push(`• ${markerName(k, language)}: ${xs.map((x) => `${dateRu(x.collected_at)} ${fmt(x.value_numeric)}`).join(' → ')} ${unit(xs[0].unit)}`);
  }
  if (ms.rows.length) { lines.push(say('events')); for (const m of ms.rows) lines.push(`• ${dateRu(m.date)} ${milestoneTitle(m.kind, m.title, language)}${m.notes ? `${noteDash}${String(m.notes).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`); }
  for (const d of docTexts) { const f = docFiles.rows.find((x) => x.sha256 === d.sha256); lines.push('', say('documentText', { file: d.filename, where: f ? `${dateRu(f.date)}, ${f.title}` : '', method: extractMethodLabel(d.method, language) }), d.text); }
  if (studies.rows.length) { lines.push(say('studies')); for (const s of studies.rows) lines.push(`• ${dateRu(s.date)} ${modalityLabel(s.modality, language)} ${s.body_region || ''}${s.response ? `, ${language === 'ru' ? s.response : responseLabel(s.response, language)}` : ''}${s.impression_text ? `: ${String(s.impression_text).replace(/\s+/g, ' ').slice(0, 500)}` : ''}`); }
  if (alerts.rows.length) lines.push(say('alerts', { list: alerts.rows.map((a) => { const c = a.context || {}; return `${dateRu(a.triggered_at)} ${(c.message ? alertMessage(c, aiFormat(language)) : '') || c.key || ''} [${a.status}]`; }).join('; ') }));
  for (const rv of reviews.rows) lines.push('', say('review', { ym: rv.ym }), rv.text);
  for (const c of comments.rows) lines.push('', say('comment', { type: c.subject_type }), c.text.slice(0, 1500));
  return { sinceDate, text: lines.join('\n') };
}

export async function generateQuestions(userId, id, { tz = DEFAULT_TZ } = {}) {
  const appt = await getAppointment(userId, id);
  if (!appt) return null;
  const language = await userLanguage(userId);
  const [profile, since] = await Promise.all([buildPatientProfile(userId, { tz, language }), sinceContext(userId, appt, language)]);
  const say = (key) => t(language, `aiContext.visit.${key}`);
  const user = `${t(language, 'aiContext.ask.patientData')}\n${profile}\n\n${say('section')}\n${since.text}\n\n${say('ask')}`;
  const out = await llmChat({ system: patientPrompt(language, 'visitQuestions'), user, maxTokens: 5000, tier: 'main', language });
  const text = out.text.trim() + (out.truncated ? say('truncated') : '');
  if (!text) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(
    'update appointments set questions = $3, questions_context = $4, questions_model = $5, questions_at = now(), updated_at = now() where user_id = $1 and id = $2 returning *',
    [userId, id, text, `${out.promptTag}\n${user}`, out.model]
  );
  return toAppointment(r.rows[0]);
}

/** The doctor's report: a consult milestone with the files, appointment marked done. */
export async function attachReport(userId, id, { files = [], summary = '', tz = DEFAULT_TZ } = {}) {
  const appt = await getAppointment(userId, id);
  if (!appt) return null;
  const language = await userLanguage(userId);
  const { milestoneId, stored } = await transaction(async (client) => {
    let milestoneId = appt.reportMilestoneId;
    const title = t(language, 'feedTitles.appointment', { doctor: appt.doctor || t(language, 'feedTitles.appointmentDoctor') });
    const notes = [appt.notes, summary].filter(Boolean).join('\n');
    let eventId;
    if (milestoneId) {
      const m = await client.query('update milestones set notes = coalesce(nullif($3, \'\'), notes), updated_at = now() where user_id = $1 and id = $2 returning event_id', [userId, milestoneId, notes]);
      eventId = m.rows[0]?.event_id;
      if (!eventId) milestoneId = null; // milestone deleted meanwhile: create a fresh one below
    }
    if (!milestoneId) {
      eventId = await addEvent(client, userId, { type: 'MILESTONE', date: appt.date, tz, title: `${kindLabel('consult', language)}: ${title}`, notes: notes || null, meta: { kind: 'consult', tone: 'neutral', appointmentId: id }, source: 'appointments' });
      const m = await client.query(
        `insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,$3,'consult','neutral',$4,$5) returning id`,
        [userId, eventId, appt.date, title, notes || null]
      );
      milestoneId = m.rows[0].id;
    }
    const stored = [];
    for (const f of files) stored.push(await storeAttachment(client, userId, eventId, f.buf, f.mime, f.filename));
    await client.query(`update appointments set status = 'done', report_milestone_id = $3, updated_at = now() where user_id = $1 and id = $2`, [userId, id, milestoneId]);
    return { milestoneId, stored };
  });
  const { autoExtract } = await import('./extracts.js');
  await autoExtract(userId, stored);
  return { appointment: await getAppointment(userId, id), milestoneId, attachments: stored };
}
