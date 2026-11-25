/**
 * One Markdown file with the patient's data for a general-purpose AI app (Claude, ChatGPT): the person
 * uploads it as a file or pastes it and asks questions there. Plain data first, AI outputs (if included)
 * clearly labelled as such.
 */
import { pool } from './db.js';
import { aiFormat, aiNumber } from './aiFormat.js';
import { getSetting } from './settings.js';
import { DEFAULT_TZ, todayKey, addDays, dayRange } from './dates.js';
import { buildFullDossier, aiDay, milestoneDocs } from './patientProfile.js';
import { keyKeys, markerName } from './canonical.js';
import { computeRecist, responseLabel } from './recist.js';
import { notesForAi } from './notes.js';
import { rowToEntry } from './symptoms.js';
import { scaleShort, scalesWithValues } from './diaryScales.js';
import { describeSchedule, scheduleFromRow, isDoseDay } from './schedule.js';
import { refText } from './labsQuery.js';
import { dayStatuses } from './medsDays.js';
import { patientCard, ageOn, yearsText } from './patientCard.js';
import { alertMessage } from './alerts.js';
import { doseNote, doseUnit, modalityLabel, routeLabel } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { raw, t } from './i18n.js';
import { displayUnit } from '../../../shared/units.js';

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const dayOf = (ts, tz) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

export async function buildDossierMarkdown(userId, { tz = DEFAULT_TZ, from, to, withNotes = true, withAi = false, allLabs = false, withDocs = true } = {}) {
  const language = await userLanguage(userId);
  const say = (key, args) => t(language, `dossier.${key}`, args);
  const fmt = (n) => aiNumber(n, 2, language);
  const dateRu = (d) => aiDay(d, language);
  const unitRu = (u) => doseUnit(u, language);
  const unit = (u) => displayUnit(u, language) || '';
  const none = say('none');
  const today = todayKey(tz);
  to = to || today;
  from = from || addDays(to, -365);
  const [regimen, doses, labs, studies, lesions, meas, sym, alerts, appts, infusions, courses] = await Promise.all([
    pool.query(`select r.start_date::text as start_date, ri.id as item_id, m.id as med_id, m.name, m.role, m.instructions, ri.dose_value, ri.dose_unit, ri.frequency_rule, ri.schedule_days, ri.interval_days, ri.times_per_day from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id
                where r.user_id = $1 and (r.end_date is null or r.end_date > now()) order by (m.role = 'systemic') desc, m.sort_order, r.start_date desc`, [userId]),
    pool.query(`select regimen_item_id, effective_from::text as effective_from, dose_value, dose_unit, reason from dose_changes where user_id = $1 order by effective_from`, [userId]),
    pool.query(`select t.canonical_key as key, t.code, t.category, r.collected_at, r.value_numeric, r.value_text, r.unit_canonical, r.ref_low, r.ref_high, r.lab_name
                  from lab_results_eff r join lab_tests t on t.id = r.test_id where r.user_id = $1 ${allLabs ? '' : 'and r.collected_at::date between $2 and $3'} order by r.collected_at, t.category, t.code`, allLabs ? [userId] : [userId, from, to]),
    pool.query(`select id, study_date::text as date, modality, body_region, response, impression_text from imaging_studies where user_id = $1 order by study_date`, [userId]),
    pool.query(`select id, name, location, is_target, retired from lesions where user_id = $1`, [userId]),
    pool.query(`select lesion_id, study_id, size_mm, note from lesion_measurements where user_id = $1`, [userId]),
    pool.query(`select * from symptom_entries where user_id = $1 and date between $2 and $3 order by date`, [userId, from, to]),
    pool.query(`select triggered_at, status, context from alerts where user_id = $1 and triggered_at::date between $2 and $3 order by triggered_at`, [userId, from, to]),
    pool.query(`select date::text as date, time, doctor, place, notes, status, questions from appointments where user_id = $1 order by date desc limit 10`, [userId]),
    pool.query(`select i.date::text as date, i.dose_value, i.dose_unit, i.place, i.reaction, i.notes, coalesce(i.route, a.route) as route, a.short_name, a.name from infusion_sessions i join infusion_agents a on a.id = i.agent_id where i.user_id = $1 and i.date between $2 and $3 order by i.date`, [userId, from, to]),
    pool.query(`select c.title, c.planned_count, c.cadence_days, c.start_date::text as start_date, c.status, a.short_name, a.name, (select count(*)::int from infusion_sessions s where s.course_id = c.id) as done from infusion_courses c join infusion_agents a on a.id = c.agent_id where c.user_id = $1 order by c.start_date desc`, [userId]),
  ]);

  const L = [];
  L.push(say('title'), '');
  L.push(say('intro', { today: dateRu(today), from: dateRu(from), to: dateRu(to), allLabs: allLabs ? say('introAllLabs') : '', tz }), '');
  L.push(say('instruction', { docs: withDocs ? say('instructionDocs') : '', notes: withNotes ? say('instructionNotes') : '' }), '');

  const anamnesis = getSetting('anamnesis') || '';
  // the file goes to an AI service: age and diagnosis, never the name or the date of birth
  const card = patientCard();
  const age = ageOn(card.birthDate, today);
  const profile = (key, args) => t(language, `aiContext.profile.${key}`, args);
  const who = [age != null ? profile('age', { years: yearsText(age, language) }) : '', card.diagnosis ? profile('diagnosis', { text: card.diagnosis }) : ''].filter(Boolean).join('; ');
  L.push(say('h.anamnesis'), '', ...(who ? [profile('patient', { parts: who }), ''] : []), anamnesis.trim() || say('notFilled'), '');

  L.push(say('h.therapy'), '');
  const reg = regimen.rows.find((x) => x.role === 'systemic') || regimen.rows[0];
  const supportMeds = regimen.rows.filter((x) => x !== reg);
  if (reg) {
    const admins = await dayStatuses(userId, { medicationId: reg.med_id, from, to });
    if (supportMeds.length) L.push(say(supportMeds.every((x) => x.role === 'support') ? 'support' : 'otherMedications', { list: supportMeds.map((x) => say('supportItem', { name: x.name, dose: x.dose_value != null ? ` ${fmt(x.dose_value)} ${unitRu(x.dose_unit)}` : '', times: Number(x.times_per_day) > 1 ? profile('timesPerDay', { n: x.times_per_day }) : '', instructions: x.instructions ? ` (${x.instructions})` : '', date: dateRu(x.start_date) })).join('; ') }));
    L.push(say('current', { name: reg.name, dose: reg.dose_value ? `${fmt(reg.dose_value)} ${unitRu(reg.dose_unit)}` : '', schedule: describeSchedule({ ...scheduleFromRow(reg), startDate: reg.start_date }, language), date: dateRu(reg.start_date) }));
    const regDoses = doses.rows.filter((d) => d.regimen_item_id === reg.item_id); // the main drug's own history
    if (regDoses.length) L.push(say('doseHistory', { list: regDoses.map((d) => `${dateRu(d.effective_from)} ${fmt(d.dose_value)} ${unitRu(d.dose_unit)}${d.reason ? ` (${doseNote(d.reason, language)})` : ''}`).join('; ') }));
    const byDay = new Map(admins.map((a) => [a.day, a.status]));
    const start = reg.start_date > from ? reg.start_date : from;
    const end = to > today ? today : to;
    const sch = { ...scheduleFromRow(reg), startDate: reg.start_date };
    const days = start <= end ? dayRange(start, end).filter((d) => isDoseDay(sch, d) || byDay.has(d)) : [];
    const cnt = (s) => days.filter((d) => byDay.get(d) === s).length;
    const missed = days.filter((d) => !byDay.get(d) && d < today).length;
    if (days.length) L.push(say('adherence', { taken: cnt('TAKEN'), days: days.length, partial: cnt('PARTIAL') ? profile('adherencePartial', { n: cnt('PARTIAL') }) : '', skipped: cnt('SKIPPED'), paused: cnt('PAUSED'), missed }));
    const paused = days.filter((d) => byDay.get(d) === 'PAUSED');
    if (paused.length) L.push(say('pauseDays', { from: paused[0], to: paused[paused.length - 1], n: paused.length }));
  } else L.push(say('noRegimen'));
  L.push('');

  L.push(say(allLabs ? 'h.labsAll' : 'h.labs', { n: labs.rows.length }), '');
  L.push(say('labsNote'), '');
  const keyOrder = keyKeys();
  const byKey = new Map();
  for (const r of labs.rows) { const k = r.key || `~${r.code}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  const ordered = [...byKey.keys()].sort((a, b) => { const ia = keyOrder.indexOf(a), ib = keyOrder.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); });
  for (const k of ordered) {
    const xs = byKey.get(k);
    const name = k.startsWith('~') ? k.slice(1) : markerName(k, language);
    const cat = xs[0].category === 'urine' ? t(language, 'aiContext.urine') : '';
    L.push(`### ${name}${cat}`, '');
    L.push(table([say('col.date'), say('col.value'), say('col.unit'), say('col.reference'), say('col.lab')], xs.map((r) => [dayOf(r.collected_at, tz), r.value_numeric != null ? fmt(r.value_numeric) : (r.value_text || ''), unit(r.unit_canonical), refText(r.ref_low, r.ref_high, fmt), r.lab_name || ''])), '');
  }
  if (!labs.rows.length) L.push(none, '');

  L.push(say('h.imaging'), '');
  const studyList = studies.rows.map((s) => ({ id: s.id, date: s.date, modality: s.modality, region: s.body_region, response: s.response, impression: s.impression_text }));
  const recist = computeRecist(studyList, lesions.rows.map((l) => ({ id: l.id, isTarget: l.is_target, retired: l.retired })), meas.rows.map((m) => ({ studyId: m.study_id, lesionId: m.lesion_id, sizeMm: m.size_mm })));
  for (const s of studyList) {
    const sizes = meas.rows.filter((m) => m.study_id === s.id).map((m) => { const l = lesions.rows.find((x) => x.id === m.lesion_id); return `${l?.name || '?'}${l?.location ? ` (${l.location})` : ''}: ${m.size_mm != null ? t(language, 'aiContext.mm', { v: fmt(m.size_mm) }) : say('noSize')}${m.note ? `, ${m.note}` : ''}`; });
    const r = recist.find((x) => x.studyId === s.id);
    L.push(`- **${dateRu(s.date)} ${modalityLabel(s.modality, language)}${s.region ? ` ${s.region}` : ''}**${s.response ? t(language, 'aiContext.profile.studyResponse', { response: responseLabel(s.response, language) }) : ''}${r?.sum != null && r.response !== 'baseline' ? say('recist', { sum: fmt(r.sum), response: responseLabel(r.response, language), change: `${r.changeFromBaselinePct > 0 ? '+' : ''}${r.changeFromBaselinePct}` }) : ''}`);
    if (sizes.length) L.push(say('lesions', { list: sizes.join('; ') }));
    if (s.impression) L.push(say('impression', { text: String(s.impression).replace(/\s+/g, ' ') }));
  }
  if (!studyList.length) L.push(none);
  L.push('');

  L.push(say('h.milestones'), '');
  const full = await buildFullDossier(userId, { tz, language });
  const heads = (key) => raw(language, `aiContext.dossier.${key}`);
  const ms = full.split(heads('milestones'))[1]?.split(`\n${heads('studies')}`)[0]?.split(`\n${heads('keyLabs')}`)[0] || '';
  L.push(ms.trim() || none, '');
  if (withDocs) {
    const docs = await milestoneDocs(pool, userId, { each: 8000, total: 80000, language });
    L.push(say('h.documents', { n: docs.length }), '');
    for (const d of docs) L.push(say('documentHead', { date: dateRu(d.date), title: d.title, file: d.filename }), '', d.method === 'llm' ? say('fromLlm') : d.method === 'ocr' ? say('fromOcr') : '', d.text.trim(), '');
    if (!docs.length) L.push(none, '');
  }

  L.push(say('h.infusions'), '');
  for (const c of courses.rows) L.push(say('course', { name: c.title || c.short_name || c.name, done: c.done, of: c.planned_count ? say('courseOf', { n: c.planned_count }) : '', cadence: c.cadence_days ? say('courseCadence', { n: c.cadence_days }) : '', date: dateRu(c.start_date), status: say(`courseStatus.${c.status === 'active' ? 'active' : c.status === 'done' ? 'done' : 'canceled'}`) }));
  if (infusions.rows.length) L.push('', table([say('col.date'), say('col.medication'), say('col.dose'), say('col.how'), say('col.where'), say('col.wellbeingNote')], infusions.rows.map((x) => [x.date, x.short_name || x.name, x.dose_value != null ? `${fmt(x.dose_value)} ${unit(x.dose_unit)}` : '', routeLabel(x.route, language) || '', x.place || '', [x.reaction, x.notes].filter(Boolean).join('; ')])));
  if (!courses.rows.length && !infusions.rows.length) L.push(none);
  L.push('');

  L.push(say('h.diary', { n: sym.rows.length }), '');
  if (sym.rows.length) {
    L.push(say('scalesNote'), '');
    L.push(table([say('col.date'), say('col.wellbeing'), say('col.bp'), say('col.pulse'), say('col.weight'), say('col.temp'), say('col.steps'), say('col.symptoms'), say('col.note')], sym.rows.map((e) => [typeof e.date === 'string' ? e.date : dayOf(e.date, tz), e.wellbeing ?? '', e.bp_sys != null ? `${e.bp_sys}/${e.bp_dia ?? ''}` : '', e.pulse ?? '', e.weight_kg != null ? fmt(e.weight_kg) : '', e.temp_c != null ? fmt(e.temp_c) : '', e.steps ?? '',
      scalesWithValues(rowToEntry(e), 1).map((k) => `${scaleShort(k, language)} ${rowToEntry(e)[k]}`).join(', '), e.notes || ''])));
  } else L.push(none);
  L.push('');

  L.push(say('h.alerts'), '');
  if (alerts.rows.length) for (const a of alerts.rows) L.push(`- ${dayOf(a.triggered_at, tz)} ${say(a.context?.severity === 'RED' ? 'important' : 'watch')}: ${a.context?.message ? alertMessage(a.context, aiFormat(language)) : ''} [${say(a.status === 'OPEN' ? 'alertOpen' : 'alertRead')}]`);
  else L.push(none);
  L.push('');

  L.push(say('h.appointments'), '');
  if (appts.rows.length) {
    for (const a of appts.rows) {
      L.push(`- ${dateRu(a.date)}${a.time ? ` ${a.time}` : ''}${a.doctor ? `, ${a.doctor}` : ''}${a.place ? `, ${a.place}` : ''} (${say(`apptStatus.${a.status === 'planned' ? 'planned' : a.status === 'done' ? 'done' : 'canceled'}`)})${a.notes ? `: ${a.notes}` : ''}`);
      if (withAi && a.questions) L.push('', `  > ${say('visitList')}`, ...String(a.questions).split('\n').map((l) => `  > ${l}`), '');
    }
  } else L.push(none);
  L.push('');

  if (withNotes) {
    const notes = await notesForAi(userId, { limit: 12, chars: 2500 });
    L.push(say('h.notes', { n: notes.length }), '');
    for (const n of notes) L.push(`### ${n.title}`, '', [n.url ? say('noteLink', { v: n.url }) : null, n.sourceName ? say('noteSource', { v: n.sourceName }) : null, n.tags?.length ? say('noteTags', { v: n.tags.join(', ') }) : null, say('noteUpdated', { v: dateRu(n.updatedAt) })].filter(Boolean).join(' · '), '', n.text.trim(), '');
    if (!notes.length) L.push(none, '');
  }
  if (withAi) {
    const ai = full.split(heads('lastReview'))[1];
    if (ai) L.push(say('h.lastReview'), '', ai.replace(/^[^\n]*\n/, '').trim(), '');
  }
  L.push('---', say('footer', { date: dateRu(today) }));
  return L.join('\n');
}
