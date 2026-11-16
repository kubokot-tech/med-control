/**
 * Patient profile for AI prompts, rebuilt from MedControl data on every call:
 * anamnesis (free text from settings), milestones, imaging with RECIST, therapy,
 * adherence, diary summary, open alerts. Shared by every AI feature. The words are in the user's language
 * (locales/<language>/server/aiContext.json); what the patient typed stays as typed.
 */
// db.js is imported lazily so prompt constants stay importable without a database (tests).
const db = () => import('./db.js').then((m) => m.pool);
import { getSetting } from './settings.js';
import { computeRecist, responseLabel } from './recist.js';
import { todayKey, addDays, dayKey, DEFAULT_TZ } from './dates.js';
import { protocolPromptLine, currentDiaryScales } from './protocol.js';
import { rowToEntry } from './symptomRow.js';
import { scaleShort, scalesWithValues } from './diaryScales.js';
import { describeSchedule, scheduleFromRow, isDoseDay } from './schedule.js';
import { refText } from './labsQuery.js';
import { dayStatuses } from './medsDays.js';
import { patientCard, ageOn, yearsText } from './patientCard.js';
import { extractMethodLabel } from './extractMethod.js';
import { aiFormat, aiNumber, aiDate } from './aiFormat.js';
import { has, raw, t } from './i18n.js';
import { alertMessage } from './alerts.js';
import { doseNote, doseUnit, milestoneTitle, modalityLabel, unitAtEnd } from './eventText.js';
import { displayUnit } from '../../../shared/units.js';

/** The protocol's scales first, then any other scale that has values in these entries. */
function diaryScaleKeys(entries) {
  const used = new Set(entries.flatMap((e) => scalesWithValues(e)));
  const active = currentDiaryScales();
  return [...active.filter((k) => used.has(k)), ...[...used].filter((k) => !active.includes(k))];
}

const kindWord = (kind, language) => (has(language, `aiContext.kind.${kind}`) ? t(language, `aiContext.kind.${kind}`) : kind);
export const localYmd = (d) => dayKey(d, DEFAULT_TZ);
/** A day in words for the text for the model; takes a Date, an ISO string or a calendar day. */
export const aiDay = (d, language) => {
  if (!d) return '';
  const iso = d instanceof Date ? localYmd(d) : String(d).slice(0, 10);
  return aiDate(iso, language);
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const PROMPT_VERSION = 'v3';

// Profile cache: rebuilt at most every 5 minutes, dropped on any write to the feed or settings.
const profileCache = new Map();
const PROFILE_TTL_MS = 5 * 60_000;
export function invalidateProfileCache() { profileCache.clear(); }

/** The language to write in: the caller's, or the user's own. */
export const languageOf = async (userId, language) => language ?? (await import('./userLocale.js')).userLanguage(userId);

export async function buildPatientProfile(userId, { tz = DEFAULT_TZ, language } = {}) {
  const lang = await languageOf(userId, language);
  const key = `${userId}|${tz}|${lang}`;
  const hit = profileCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.text;
  const text = await buildPatientProfileUncached(userId, { tz, language: lang });
  profileCache.set(key, { text, exp: Date.now() + PROFILE_TTL_MS });
  return text;
}

async function buildPatientProfileUncached(userId, { tz, language }) {
  const today = todayKey(tz);
  const pool = await db();
  const say = (key, args) => t(language, `aiContext.profile.${key}`, args);
  const fmt = (n) => aiNumber(n, 2, language);
  const dateRu = (d) => aiDay(d, language);
  const unitRu = (u) => doseUnit(u, language);
  const mm = (v) => t(language, 'aiContext.mm', { v });
  const sep = raw(language, 'aiContext.noteSeparator');
  const [ms, st, le, me, regimen, doses, admins, sym, alerts] = await Promise.all([
    pool.query(`select date::text as date, kind, tone, title, notes from milestones where user_id = $1 and kind <> 'ai_review' order by date`, [userId]),
    pool.query('select id, study_date::text as date, modality, body_region, response, impression_text, created_at from imaging_studies where user_id = $1 order by study_date, created_at', [userId]),
    pool.query('select id, name, location, is_target, retired from lesions where user_id = $1', [userId]),
    pool.query('select lesion_id, study_id, size_mm from lesion_measurements where user_id = $1', [userId]),
    pool.query(`select r.start_date::text as start_date, ri.id as item_id, m.id as med_id, m.name, m.role, m.instructions, ri.dose_value, ri.dose_unit, ri.frequency_rule, ri.schedule_days, ri.interval_days, ri.times_per_day
                  from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id
                 where r.user_id = $1 and (r.end_date is null or r.end_date > now()) order by (m.role = 'systemic') desc, m.sort_order, r.start_date desc`, [userId]),
    pool.query('select regimen_item_id, effective_from::text as effective_from, dose_value, dose_unit, reason from dose_changes where user_id = $1 order by effective_from', [userId]),
    dayStatuses(userId, { from: addDays(today, -29), to: today }).then((rows) => ({ rows })),
    pool.query('select * from symptom_entries where user_id = $1 and date >= $2::date order by date', [userId, addDays(today, -13)]),
    pool.query(`select triggered_at, context from alerts where user_id = $1 and status = 'OPEN' order by triggered_at desc limit 10`, [userId]),
  ]);

  const lines = [];
  const protocolLine = protocolPromptLine(language);
  if (protocolLine) lines.push(protocolLine);
  // who: age and diagnosis only; the name and the date of birth stay out of anything sent to AI
  const card = patientCard();
  const age = ageOn(card.birthDate, today);
  if (age != null || card.diagnosis) lines.push(say('patient', { parts: [age != null ? say('age', { years: yearsText(age, language) }) : '', card.diagnosis ? say('diagnosis', { text: card.diagnosis }) : ''].filter(Boolean).join('; ') }));
  const anamnesis = (getSetting('anamnesis') || '').trim();
  if (anamnesis) lines.push(`${say('anamnesisHead')}\n${anamnesis}`);

  if (ms.rows.length) {
    const docs = await milestoneDocs(pool, userId, { each: 500, total: 8000, language });
    lines.push(say('milestonesHead'));
    for (const m of ms.rows) {
      const note = (m.notes || '').replace(/\s+/g, ' ').slice(0, 300);
      lines.push(`• ${dateRu(m.date)}, ${kindWord(m.kind, language)}: ${milestoneTitle(m.kind, m.title, language)}${note ? `${sep}${note}` : ''}`);
      for (const d of docs.filter((x) => x.date === m.date && x.title === m.title)) lines.push(`  ${say('document', { file: d.filename, text: d.text.replace(/\s+/g, ' ') })}`);
    }
  }

  if (st.rows.length) {
    const studies = st.rows.map((s) => ({ id: s.id, date: s.date, modality: s.modality, createdAt: s.created_at }));
    const lesions = le.rows.map((l) => ({ id: l.id, name: l.name, location: l.location, isTarget: l.is_target, retired: l.retired }));
    const flat = me.rows.map((m) => ({ studyId: m.study_id, lesionId: m.lesion_id, sizeMm: m.size_mm != null ? Number(m.size_mm) : null }));
    const recist = computeRecist(studies, lesions, flat);
    const last = st.rows[st.rows.length - 1];
    const lastR = recist.find((r) => r.studyId === last.id);
    lines.push(say('studies', { n: st.rows.length, date: dateRu(last.date), study: `${modalityLabel(last.modality, language) || ''} ${last.body_region || ''}` }).replace(/\s+/g, ' ') +
      (last.response ? say('studyResponse', { response: responseLabel(last.response, language) }) : '') +
      (lastR ? say('studyRecist', { sum: fmt(lastR.sum), response: responseLabel(lastR.response, language), change: `${lastR.changeFromBaselinePct > 0 ? '+' : ''}${lastR.changeFromBaselinePct}` }) : '') + '.');
    if (last.impression_text) lines.push(say('lastImpression', { text: last.impression_text.replace(/\s+/g, ' ').slice(0, 600) }));
    const targets = lesions.filter((l) => l.isTarget && !l.retired);
    if (targets.length) {
      const sizes = targets.map((l) => {
        const m = me.rows.find((x) => x.lesion_id === l.id && x.study_id === last.id);
        return `${l.name}${m?.size_mm != null ? ` ${mm(fmt(m.size_mm))}` : ''}`;
      });
      lines.push(say('targets', { list: sizes.join('; ') }));
    }
  }

  const reg = regimen.rows.find((x) => x.role === 'systemic') || regimen.rows[0];
  const support = regimen.rows.filter((x) => x !== reg);
  if (reg) {
    lines.push(say('therapy', { name: reg.name, dose: fmt(reg.dose_value), unit: unitRu(reg.dose_unit), schedule: describeSchedule({ ...scheduleFromRow(reg), startDate: reg.start_date }, language), date: dateRu(reg.start_date) }).replace(/\s+/g, ' '));
    if (support.length) lines.push(say('supportList', { list: support.map((x) => say('supportItem', { name: x.name, dose: x.dose_value != null ? ` ${fmt(x.dose_value)} ${unitRu(x.dose_unit)}` : '', times: Number(x.times_per_day) > 1 ? say('timesPerDay', { n: x.times_per_day }) : '', instructions: x.instructions ? ` (${x.instructions})` : '', date: dateRu(x.start_date) })).join('; ') }));
    const regDoses = doses.rows.filter((x) => x.regimen_item_id === reg.item_id); // the main drug's own history
    if (regDoses.length > 1) lines.push(say('doseChanges', { list: regDoses.map((x) => `${dateRu(x.effective_from)} → ${fmt(x.dose_value)} ${unitRu(x.dose_unit)}${x.reason ? ` (${doseNote(x.reason, language)})` : ''}`).join('; ') }));
    const taken = admins.rows.filter((a) => a.status === 'TAKEN').length;
    const skipped = admins.rows.filter((a) => a.status === 'SKIPPED').length;
    const paused = admins.rows.filter((a) => a.status === 'PAUSED').length;
    const partial = admins.rows.filter((a) => a.status === 'PARTIAL').length;
    const sch = { ...scheduleFromRow(reg), startDate: reg.start_date };
    const doseDays = Array.from({ length: 30 }, (_, i) => addDays(today, -i)).filter((d) => isDoseDay(sch, d)).length;
    lines.push(say('adherence', { doseDays, taken, partial: partial ? say('adherencePartial', { n: partial }) : '', skipped, paused: paused ? say('adherencePaused', { n: paused }) : '', none: Math.max(0, doseDays - taken - partial - skipped - paused) }));
  }

  const inf = await pool.query(
    `select a.short_name, a.name, count(*)::int as n, max(i.date)::text as last, string_agg(distinct (coalesce(i.dose_value::text, '') || ' ' || coalesce(i.dose_unit, '')), ', ') as doses
       from infusion_sessions i join infusion_agents a on a.id = i.agent_id where i.user_id = $1 and i.date >= $2::date group by a.id, a.short_name, a.name order by n desc`,
    [userId, addDays(today, -89)]).catch(() => ({ rows: [] }));
  if (inf.rows.length) lines.push(say('infusions', { list: inf.rows.map((x) => say('infusionItem', { name: x.short_name || x.name, n: x.n, doses: String(x.doses).trim().split(', ').map((d) => unitAtEnd(d, language)).join(', '), date: dateRu(x.last) })).join('; ') }));

  if (sym.rows.length) {
    const num = (k) => sym.rows.map((r) => r[k]).filter((v) => v != null).map(Number);
    const bpS = num('bp_sys'), bpD = num('bp_dia'), temp = num('temp_c'), w = num('weight_kg');
    const scale = (k, label) => { const xs = num(k); return xs.length ? `${label} ${fmt(mean(xs))}` : null; };
    const parts = [
      bpS.length ? say('diaryBp', { avgS: Math.round(mean(bpS)), avgD: Math.round(mean(bpD)), maxS: Math.max(...bpS), maxD: Math.max(...bpD) }) : null,
      temp.length ? say('diaryTemp', { v: fmt(Math.max(...temp)) }) : null,
      w.length ? say('diaryWeight', { from: fmt(w[0]), to: fmt(w[w.length - 1]) }) : null,
      scale('wellbeing', say('diaryWellbeing')),
      ...diaryScaleKeys(sym.rows.map(rowToEntry)).map((k) => { const xs = sym.rows.map(rowToEntry).map((e) => e[k]).filter((v) => v != null).map(Number); return xs.length ? `${scaleShort(k, language)} (0–3) ${fmt(mean(xs))}` : null; }),
    ].filter(Boolean);
    lines.push(say('diary', { n: sym.rows.length, parts: parts.join('; ') }));
    const notes = sym.rows.map((r) => r.notes).filter(Boolean).slice(-3);
    if (notes.length) lines.push(say('diaryNotes', { text: notes.map((n) => String(n).replace(/\s+/g, ' ').slice(0, 160)).join(' | ') }));
  }

  if (alerts.rows.length) {
    lines.push(say('alerts', { list: alerts.rows.map((a) => {
      const c = a.context || {};
      return `${dateRu(a.triggered_at)} ${c.title || (c.message ? alertMessage(c, aiFormat(language)) : '') || c.key || say('alert')}`;
    }).join('; ') }));
  }

  return lines.join('\n');
}

/** Everything the model needs to rewrite the master context: full notes, all studies, latest labs review, key markers. */
/** Texts of files attached to milestones, in date order, capped. */
export async function milestoneDocs(pool, userId, caps) {
  const { extractsForAi } = await import('./extracts.js');
  const files = await pool.query(`select a.sha256, a.filename, m.date::text as date, m.title from milestones m join attachments a on a.event_id = m.event_id
     where m.user_id = $1 and m.kind <> 'ai_review' order by m.date, a.created_at`, [userId]);
  const texts = await extractsForAi(userId, files.rows, caps);
  return texts.map((t) => ({ ...t, ...files.rows.find((f) => f.sha256 === t.sha256) }));
}

export async function buildFullDossier(userId, { tz = DEFAULT_TZ, language } = {}) {
  const pool = await db();
  const lang = await languageOf(userId, language);
  const say = (key, args) => t(lang, `aiContext.dossier.${key}`, args);
  const fmt = (n) => aiNumber(n, 2, lang);
  const dateRu = (d) => aiDay(d, lang);
  const [ms, st, le, me, review, keyLabs] = await Promise.all([
    pool.query(`select date::text as date, kind, tone, title, notes from milestones where user_id = $1 and kind <> 'ai_review' order by date`, [userId]),
    pool.query('select id, study_date::text as date, modality, body_region, response, impression_text from imaging_studies where user_id = $1 order by study_date', [userId]),
    pool.query('select id, name, location, is_target, retired from lesions where user_id = $1', [userId]),
    pool.query('select lesion_id, study_id, size_mm, note from lesion_measurements where user_id = $1', [userId]),
    pool.query(`select subject_id as ym, text from ai_comments where user_id = $1 and subject_type = 'labs_month' order by subject_id desc, created_at desc limit 1`, [userId]),
    pool.query(`select * from (
        select t.canonical_key as key, r.collected_at, r.value_numeric, r.unit_canonical as unit, r.ref_low, r.ref_high,
               row_number() over (partition by t.canonical_key order by r.collected_at desc) as rn
          from lab_results_eff r join lab_tests t on t.id = r.test_id
         where r.user_id = $1 and t.canonical_key is not null and r.value_numeric is not null
      ) x where rn <= 3 order by key, collected_at`, [userId]),
  ]);
  const { keyKeys, markerName } = await import('./canonical.js');
  const keys = new Set(keyKeys());
  const lines = [await buildPatientProfile(userId, { tz, language: lang })];
  lines.push('', say('milestones'));
  for (const m of ms.rows) lines.push(`• ${dateRu(m.date)}, ${kindWord(m.kind, lang)}, ${m.tone}: ${milestoneTitle(m.kind, m.title, lang)}${m.notes ? `\n  ${m.notes.replace(/\s+/g, ' ')}` : ''}`);
  const docs = await milestoneDocs(pool, userId, { each: 6000, total: 60000, language: lang });
  if (docs.length) {
    lines.push('', say('documents'));
    for (const d of docs) lines.push(say('documentHead', { date: dateRu(d.date), title: d.title, file: d.filename, method: extractMethodLabel(d.method, lang) }), d.text);
  }
  if (st.rows.length) {
    lines.push('', say('studies'));
    for (const s of st.rows) {
      const sizes = me.rows.filter((x) => x.study_id === s.id).map((x) => { const l = le.rows.find((y) => y.id === x.lesion_id); return `${l?.name || '?'}${x.size_mm != null ? ` ${t(lang, 'aiContext.mm', { v: fmt(x.size_mm) })}` : ''}${x.note ? ` (${x.note})` : ''}`; });
      lines.push(`• ${dateRu(s.date)} ${modalityLabel(s.modality, lang)} ${s.body_region || ''}${s.response ? `, ${responseLabel(s.response, lang)}` : ''}${sizes.length ? say('lesions', { list: sizes.join('; ') }) : ''}${s.impression_text ? `\n  ${s.impression_text.replace(/\s+/g, ' ')}` : ''}`);
    }
  }
  const byKey = new Map();
  for (const r of keyLabs.rows) { if (!keys.has(r.key)) continue; if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  if (byKey.size) {
    lines.push('', say('keyLabs'));
    for (const [k, xs] of byKey) lines.push(`${markerName(k, lang)}: ` + xs.map((h) => `${dateRu(h.collected_at)} ${fmt(h.value_numeric)}`).join('; ') + ` ${displayUnit(xs[0].unit, lang) || ''}` + (refText(xs[0].ref_low, xs[0].ref_high) ? t(lang, 'aiContext.reference', { ref: refText(xs[0].ref_low, xs[0].ref_high, fmt) }) : ''));
  }
  if (review.rows.length) lines.push('', `${raw(lang, 'aiContext.dossier.lastReview')}${say('lastReviewNote', { ym: review.rows[0].ym })}`, review.rows[0].text);
  return lines.join('\n');
}
