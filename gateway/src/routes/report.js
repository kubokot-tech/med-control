import { MARK_SIZE, pdfBrandLine, pdfMark } from '../lib/pdfBrand.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { pool } from '../lib/db.js';
import { dayStatuses } from '../lib/medsDays.js';
import { DEFAULT_TZ, todayKey, addDays, dayRange } from '../lib/dates.js';
import { entry as catalogEntry, keyKeys, markerShort } from '../lib/canonical.js';
import { flag, refText } from '../lib/labsQuery.js';
import { computeRecist, responseLabel } from '../lib/recist.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { llmChat } from '../lib/llm.js';
import { createHash } from 'node:crypto';
import { rowToEntry } from '../lib/symptoms.js';
import { SCALE_KEYS, scaleShort } from '../lib/diaryScales.js';
import { describeSchedule, scheduleFromRow, isDoseDay } from '../lib/schedule.js';
import { userLabUnits } from '../lib/labDisplay.js';
import { comparatorOf } from '../lib/units.js';
import { patientCard, ageOn, yearsText } from '../lib/patientCard.js';
import { userFormat } from '../lib/userLocale.js';
import { alertMessage } from '../lib/alerts.js';
import { doseNote, doseUnit, milestoneTitle, modalityLabel, routeLabel } from '../lib/eventText.js';
import { prompt } from '../lib/aiPrompts.js';
import { t } from '../lib/i18n.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../shared/format.js';
import { bodyUnits, displayUnit } from '../../../shared/units.js';

export const SECTIONS = ['questions', 'anamnesis', 'therapy', 'infusions', 'milestones', 'imaging', 'labs', 'symptoms', 'alerts', 'documents'];

/** Anamnesis in 6–10 lines by the fast model, cached by the hash of the source text and the language. */
async function briefAnamnesis(full, language) {
  const hash = 'v2:' + createHash('sha256').update(language === DEFAULT_LANGUAGE ? full : `${language}\n${full}`).digest('hex').slice(0, 16);
  try { const c = JSON.parse(getSetting('anamnesis_brief') || 'null'); if (c?.hash === hash && c.text) return { text: c.text, cached: true }; } catch { /* ignore */ }
  const out = await llmChat({ system: prompt(language, 'briefSystem'), user: t(language, 'aiContext.briefUser', { prompt: prompt(language, 'brief'), text: full }), maxTokens: 1600, tier: 'fast', language });
  const text = out.text.trim() + (out.truncated ? t(language, 'doctorReport.anamnesis.truncated') : '');
  if (text) await setSetting('anamnesis_brief', JSON.stringify({ hash, text, model: out.model, at: new Date().toISOString() }));
  return { text, cached: false, model: out.model };
}

const FONT_DIR = fileURLToPath(new URL('../../fonts/', import.meta.url));
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const C = { fg: '#1e2a36', fg2: '#56657a', fg3: '#7d8a99', accent: '#1f5fa6', soft: '#e4edf9', warn: '#a8641e', warnBg: '#fbeedb', danger: '#8b2e2e', border: '#dbe3ec', surface2: '#e7edf4' };
const dayOf = (ts, tz) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
// Stored visit questions may be in either language, whichever was set when they were made.
const heading = (key) => LANGUAGES.map((l) => prompt(l, `visitHeadings.${key}`));
const VISIT_HEADING = new RegExp(`^(${['period', 'tell', 'ask', 'bring'].flatMap(heading).join('|')})[.:]?$`, 'i');
const VISIT_FOOTER = new RegExp(`^(${heading('footer').join('|')})`, 'i');

export default async function reportRoutes(app) {
  app.get('/report/doctor.pdf', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const tz = req.user.tz || DEFAULT_TZ;
    // dates and numbers in the user's format (docs/I18N.md)
    const f = await userFormat(userId);
    const { language } = f;
    const say = (key, args) => t(language, `doctorReport.${key}`, args);
    const unitWord = (u) => displayUnit(u, language) || '';
    const body = bodyUnits({ temperature: f.temperature, weight: f.weight, language });
    const fmtDay = (k) => f.date(k, { day: 'numeric', month: 'long', year: 'numeric' });
    const fmtShort = (k) => f.date(k, { day: '2-digit', month: '2-digit', year: '2-digit' });
    const fmtNum = (v) => f.number(v, { maximumFractionDigits: 2 });
    const today = todayKey(tz);
    const to = DAY_RX.test(req.query?.to || '') ? req.query.to : today;
    const from = DAY_RX.test(req.query?.from || '') ? req.query.from : addDays(to, -90);

    const q0 = req.query || {};
    const selected = q0.sections === undefined
      ? SECTIONS.filter((name) => name !== 'documents')
      : String(q0.sections).split(',').map((name) => name.trim()).filter((name) => SECTIONS.includes(name));
    const sections = new Set(selected);
    if (q0.questions === '0') sections.delete('questions');
    if (!sections.size) return reply.code(400).send({ error: 'report_sections_required' });
    const on = (name) => sections.has(name);
    const withQuestions = on('questions');
    const allMilestones = q0.milestones === 'all';
    const allLabs = q0.labs === 'all';
    const anamnesisMode = q0.anamnesis === 'brief' ? 'brief' : 'full';
    // Visit questions: the next planned appointment with a prepared list, else the latest one that has it
    const qa = withQuestions ? await pool.query(`select date::text as date, doctor, questions, questions_at from appointments where user_id = $1 and questions is not null
      order by (status = 'planned' and date >= $2) desc, date desc limit 1`, [userId, today]) : { rows: [] };
    // ---- data ----
    const infusions = await pool.query(`select i.date::text as date, i.time, i.dose_value, i.dose_unit, i.place, i.reaction, coalesce(i.route, a.route) as route, a.short_name, a.name from infusion_sessions i join infusion_agents a on a.id = i.agent_id where i.user_id = $1 and i.date between $2 and $3 order by i.date`, [userId, from, to]).catch(() => ({ rows: [] }));
    const [regimen, doses, milestones, studies, lesions, meas, labs, sym, alerts, docs] = await Promise.all([
      pool.query(`select r.start_date::text as start_date, m.id as med_id, m.name, m.role, m.instructions, ri.id as item_id, ri.dose_value, ri.dose_unit, ri.frequency_rule, ri.schedule_days, ri.interval_days, ri.time_windows, ri.times_per_day
                  from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id
                  where r.user_id = $1 and (r.end_date is null or r.end_date > now()) order by (m.role = 'systemic') desc, m.sort_order, r.start_date desc`, [userId]),
      pool.query(`select regimen_item_id, effective_from::text as effective_from, dose_value, dose_unit, reason from dose_changes where user_id = $1 order by effective_from`, [userId]),
      allMilestones ? pool.query(`select date::text as date, kind, tone, title, notes from milestones where user_id = $1 and kind <> 'ai_review' order by date`, [userId]) : pool.query(`select date::text as date, kind, tone, title, notes from milestones where user_id = $1 and date between $2 and $3 and kind <> 'ai_review' order by date`, [userId, from, to]),
      pool.query(`select id, study_date::text as date, modality, body_region, response, impression_text from imaging_studies where user_id = $1 order by study_date`, [userId]),
      pool.query(`select id, name, location, is_target, retired from lesions where user_id = $1`, [userId]),
      pool.query(`select lesion_id, study_id, size_mm from lesion_measurements where user_id = $1`, [userId]),
      pool.query(`select t.canonical_key as key, t.category, r.collected_at, r.value_numeric, r.value_text, r.unit_canonical, r.ref_low, r.ref_high, r.lab_name
                  from lab_results_eff r join lab_tests t on t.id = r.test_id
                  where r.user_id = $1 and t.canonical_key is not null order by t.canonical_key, r.collected_at desc`, [userId]),
      pool.query(`select * from symptom_entries where user_id = $1 and date between $2 and $3 order by date`, [userId, from, to]),
      pool.query(`select triggered_at, status, context from alerts where user_id = $1 and triggered_at::date between $2 and $3 order by triggered_at desc`, [userId, from, to]),
      pool.query(`select count(*)::int as n, min(doc_date) as first, max(doc_date) as last from ingest_documents where user_id = $1 and doc_date between $2 and $3`, [userId, from, to]),
    ]);

    // adherence
    const reg = regimen.rows.find((x) => x.role === 'systemic') || regimen.rows[0] || null;
    const otherMeds = regimen.rows.filter((x) => x !== reg);
    let adherence = null;
    if (reg) {
      const admins = await dayStatuses(userId, { medicationId: reg.med_id, from, to });
      const start = reg.start_date > from ? reg.start_date : from;
      const end = to > today ? today : to;
      const byDay = new Map(admins.map((a) => [a.day, a.status]));
      const sch = { ...scheduleFromRow(reg), startDate: reg.start_date };
      const days = start <= end ? dayRange(start, end).filter((d) => isDoseDay(sch, d) || byDay.has(d)) : [];
      const taken = days.filter((d) => byDay.get(d) === 'TAKEN').length;
      const skipped = days.filter((d) => byDay.get(d) === 'SKIPPED').length;
      const paused = days.filter((d) => byDay.get(d) === 'PAUSED').length;
      const partial = days.filter((d) => byDay.get(d) === 'PARTIAL' && d < today).length;
      const missed = days.filter((d) => !byDay.get(d) && d < today).length;
      const active = days.length - paused;
      adherence = { days: active, taken, skipped, paused, partial, missed, pct: active ? Math.round((taken / active) * 100) : 0 };
    }

    // labs: latest + previous per key
    const byKey = new Map();
    for (const r of labs.rows) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
    const keyOrder = keyKeys();
    const u = await userLabUnits(userId);
    const labRows = [];
    for (const [key, arr] of byKey) {
      const ce = catalogEntry(key);
      const last = arr[0];
      const prev = arr[1] || null;
      const f = flag(last.value_numeric, last.ref_low, last.ref_high, last.value_text);
      const isKey = keyOrder.includes(key);
      if (!allLabs && !isKey && f !== 'high' && f !== 'low') continue;
      if (ce?.category === 'urine' && f === '') continue;
      const show = (row, v) => u.toDisplay(key, Number(v), row.unit_canonical).value;
      labRows.push({
        key, name: markerShort(key, u.language), isKey,
        last: last.value_numeric != null ? comparatorOf(last.value_text) + fmtNum(show(last, last.value_numeric)) : (last.value_text || '—'),
        lastDate: dayOf(last.collected_at, tz),
        prev: prev ? (prev.value_numeric != null ? comparatorOf(prev.value_text) + fmtNum(show(prev, prev.value_numeric)) : (prev.value_text || '—')) +
          (prev.unit_canonical !== last.unit_canonical ? ' ' + (u.unit(key, prev.unit_canonical) || '—') : '') : '—',
        prevDate: prev ? dayOf(prev.collected_at, tz) : '',
        unit: u.unit(key, last.unit_canonical) || '',
        ref: refText(last.ref_low != null ? show(last, last.ref_low) : null, last.ref_high != null ? show(last, last.ref_high) : null, fmtNum) || '—',
        flag: f,
        lab: last.lab_name || '',
      });
    }
    labRows.sort((a, b) => (a.isKey === b.isKey ? (a.flag && !b.flag ? -1 : !a.flag && b.flag ? 1 : 0) : a.isKey ? -1 : 1));

    // imaging
    const studyList = studies.rows.map((s) => ({ id: s.id, date: s.date, modality: s.modality, region: s.body_region, response: s.response, impression: s.impression_text }));
    const recist = computeRecist(studyList, lesions.rows.map((l) => ({ id: l.id, isTarget: l.is_target, retired: l.retired })), meas.rows.map((m) => ({ studyId: m.study_id, lesionId: m.lesion_id, sizeMm: m.size_mm })));

    // symptoms summary
    const S = sym.rows;
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
    const bpS = S.filter((e) => e.bp_sys != null).map((e) => e.bp_sys);
    const bpD = S.filter((e) => e.bp_dia != null).map((e) => e.bp_dia);
    const weights = S.filter((e) => e.weight_kg != null).map((e) => Number(e.weight_kg));
    const E = S.map(rowToEntry);
    const scales = SCALE_KEYS
      .map((key) => ({ label: scaleShort(key, language), days: E.filter((e) => e[key] != null && e[key] >= 2).length, max: Math.max(0, ...E.map((e) => e[key] ?? 0)) }))
      .filter((x) => x.days > 0);

    // ---- pdf ----
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: say('info') } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.registerFont('Inter', path.join(FONT_DIR, 'Inter-Regular.ttf'));
    doc.registerFont('Inter-Bold', path.join(FONT_DIR, 'Inter-Bold.ttf'));
    doc.registerFont('Inter-SemiBold', path.join(FONT_DIR, 'Inter-SemiBold.ttf'));
    const W = doc.page.width - 88;
    const ensure = (h) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };
    const section = (title) => { ensure(40); doc.moveDown(0.8); doc.font('Inter-Bold').fontSize(13).fillColor(C.accent).text(title); doc.moveTo(44, doc.y + 2).lineTo(44 + W, doc.y + 2).strokeColor(C.border).lineWidth(1).stroke(); doc.moveDown(0.5); };
    const para = (t, opts = {}) => { ensure(20); doc.font('Inter').fontSize(10).fillColor(C.fg).text(t, { width: W, ...opts }); };
    const muted = (t) => { ensure(24); doc.font('Inter').fontSize(9).fillColor(C.fg3).text(t, { width: W }); };
    const table = (cols, rows, widths) => {
      const drawHead = () => { const y = doc.y; doc.font('Inter-SemiBold').fontSize(8).fillColor(C.fg3); let x = 44; cols.forEach((c, i) => { doc.text(c.toUpperCase(), x + 4, y, { width: widths[i] - 8, lineBreak: false }); x += widths[i]; }); doc.y = y + 16; };
      const cellOf = (cell) => (typeof cell === 'object' && cell !== null ? cell : { text: String(cell ?? '') });
      ensure(40); drawHead();
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri].map(cellOf);
        // row height follows the tallest wrapped cell (long titles, lesion names, alert texts)
        const rowH = Math.max(18, ...r.map((c, i) => { doc.font(c.bold ? 'Inter-SemiBold' : 'Inter').fontSize(9); return doc.heightOfString(c.text, { width: widths[i] - 8 }) + 6; }));
        if (doc.y + rowH > doc.page.height - 60) { doc.addPage(); drawHead(); }
        const y = doc.y;
        if (ri % 2 === 0) doc.rect(44, y - 3, W, rowH).fill(C.surface2);
        let x = 44;
        r.forEach((c, i) => {
          doc.font(c.bold ? 'Inter-SemiBold' : 'Inter').fontSize(9).fillColor(c.color || C.fg).text(c.text, x + 4, y, { width: widths[i] - 8 });
          x += widths[i];
        });
        doc.y = y + rowH;
      }
      doc.x = 44;
      doc.moveDown(0.4);
    };
    // checkbox bullet drawn as a square (the font has no ☐)
    const checkLine = (text) => { ensure(16); const y = doc.y; doc.rect(46, y + 2, 7, 7).lineWidth(0.8).strokeColor(C.fg3).stroke(); doc.font('Inter').fontSize(10).fillColor(C.fg).text(text, 60, y, { width: W - 16 }); doc.x = 44; };
    const bulletLine = (text) => { ensure(16); const y = doc.y; doc.circle(49, y + 5.5, 1.6).fill(C.fg2); doc.font('Inter').fontSize(10).fillColor(C.fg).text(text, 58, y, { width: W - 14 }); doc.x = 44; };

    // header
    // who the patient is (Settings → «Анамнез» → «Пациент»): the doctor sees it before anything else
    const pc = patientCard();
    const age = ageOn(pc.birthDate, today);
    const who = [pc.name, pc.birthDate ? `${fmtDay(pc.birthDate)}${age != null ? ` (${yearsText(age, language)})` : ''}` : ''].filter(Boolean).join(' · ');
    const period = say('period', { from: fmtDay(from), to: fmtDay(to), today: fmtDay(today) });
    const diag = pc.diagnosis ? say('diagnosis', { text: pc.diagnosis }) : '';
    // the band grows with what it holds: a long diagnosis or period line wraps instead of running off the band
    const bandW = W - MARK_SIZE - 8; // the mark sits at the right edge of the band
    const h = (font, size, text) => (text ? doc.font(font).fontSize(size).heightOfString(text, { width: bandW }) : 0);
    const band = 50 + (who ? h('Inter-SemiBold', 13, who) + 4 : 0) + (diag ? h('Inter', 10, diag) + 4 : 0) + h('Inter', 10, period) + 16;
    doc.rect(0, 0, doc.page.width, band).fill(C.accent);
    pdfMark(doc, 44, 8);
    doc.font('Inter-Bold').fontSize(20).fillColor('#ffffff').text(say('title'), 44, 22);
    doc.y = 50;
    if (who) { doc.font('Inter-SemiBold').fontSize(13).fillColor('#ffffff').text(who, 44, doc.y, { width: bandW }); doc.y += 4; }
    if (diag) { doc.font('Inter').fontSize(10).fillColor('#ffffff').text(diag, 44, doc.y, { width: bandW }); doc.y += 4; }
    doc.font('Inter').fontSize(10).fillColor('#ffffff').text(period, 44, doc.y, { width: bandW });
    doc.y = band + 18; doc.x = 44;
    doc.fillColor(C.fg);

    // visit questions (from the appointment page), first: this is what the doctor is handed
    if (qa.rows[0]) {
      const q = qa.rows[0];
      section(say('questions.title', { date: fmtDay(q.date), doctor: q.doctor ? ` (${q.doctor})` : '' }));
      muted(say('questions.note', { date: q.questions_at ? fmtDay(dayOf(q.questions_at, tz)) : '' }));
      doc.moveDown(0.3);
      for (const raw of String(q.questions).split('\n')) {
        const line = raw.trim();
        if (!line) { doc.moveDown(0.2); continue; }
        if (VISIT_HEADING.test(line)) { ensure(24); doc.moveDown(0.3); doc.font('Inter-SemiBold').fontSize(10.5).fillColor(C.fg).text(line.replace(/[.:]$/, ''), { width: W }); continue; }
        if (VISIT_FOOTER.test(line)) continue;
        const bullet = /^[•\-–]\s*/.test(line);
        if (bullet) checkLine(line.replace(/^[•\-–]\s*/, '')); else para(line);
      }
    }

    // anamnesis (for a doctor who sees the patient for the first time)
    if (on('anamnesis')) {
      const full = (getSetting('anamnesis') || '').trim();
      if (full) {
        let text = full; let note = say('anamnesis.written');
        if (anamnesisMode === 'brief') {
          try { const b = await briefAnamnesis(full, language); if (b.text) { text = b.text; note = say('anamnesis.briefNote', { model: b.model ? ` ${b.model}` : '' }); } }
          catch (e) { req.log.warn({ err: e.message }, 'brief anamnesis failed, using full'); }
        }
        section(say(anamnesisMode === 'brief' ? 'anamnesis.titleBrief' : 'anamnesis.title'));
        muted(note);
        doc.moveDown(0.3);
        for (const raw of text.split('\n')) { const line = raw.trim(); if (!line) { doc.moveDown(0.2); continue; } if (/^[•\-–]\s*/.test(line)) bulletLine(line.replace(/^[•\-–]\s*/, '')); else para(line); }
      }
    }

    // therapy
    if (on('therapy')) {
    section(say('therapy.title'));
    if (reg) {
      const dose = reg.dose_value ? `${fmtNum(reg.dose_value)} ${doseUnit(reg.dose_unit, language)}` : '';
      para(say('therapy.line', { name: reg.name, dose, schedule: describeSchedule({ ...scheduleFromRow(reg), startDate: reg.start_date }, language), window: reg.time_windows?.preferred?.[0] ? say('therapy.window', { time: reg.time_windows.preferred[0].replace('-', '–') }) : '', date: fmtDay(reg.start_date) }));
      // the history of the main drug only (each medication has its own)
      const regDoses = doses.rows.filter((d) => d.regimen_item_id === reg.item_id);
      if (regDoses.length > 1) {
        doc.moveDown(0.3);
        table([say('col.from'), say('col.dose'), say('col.reason')], regDoses.map((d) => [fmtShort(d.effective_from), `${fmtNum(d.dose_value)} ${doseUnit(d.dose_unit, language)}`, doseNote(d.reason, language) || '']), [90, 90, W - 180]);
      }
      if (adherence) {
        const a = adherence;
        doc.moveDown(0.2);
        para(say('therapy.adherence', { taken: a.taken, days: a.days, pct: a.pct, partial: a.partial ? say('therapy.partial', { n: a.partial }) : '', skipped: a.skipped, missed: a.missed }), { continued: false });
        muted(say('therapy.notMarked'));
      }
      if (otherMeds.length) {
        doc.moveDown(0.3);
        const otherHeading = otherMeds.every((x) => x.role === 'support') ? 'col.support' : 'col.otherMedication';
        table([say(otherHeading), say('col.dose'), say('col.how'), say('col.from')], otherMeds.map((x) => [{ text: x.name, bold: true }, x.dose_value != null ? `${fmtNum(x.dose_value)} ${doseUnit(x.dose_unit, language)}${Number(x.times_per_day) > 1 ? say('therapy.timesPerDay', { n: x.times_per_day }) : ''}` : '', x.instructions || '', fmtShort(x.start_date)]), [150, 110, W - 330, 70]);
      }
    } else {
      para(say('therapy.none'));
    }
    }

    // infusions
    if (on('infusions') && infusions.rows.length) {
      section(say('infusions.title'));
      const byAgent = new Map();
      for (const x of infusions.rows) { const k = x.short_name || x.name; byAgent.set(k, (byAgent.get(k) || 0) + 1); }
      para([...byAgent].map(([k, n]) => `${k}: ${n}`).join(' · ') + '.');
      table([say('col.date'), say('col.medication'), say('col.dose'), say('col.how'), say('col.where'), say('col.wellbeing')], infusions.rows.map((x) => [fmtShort(x.date), x.short_name || x.name, x.dose_value != null ? `${fmtNum(x.dose_value)} ${unitWord(x.dose_unit)}` : '', routeLabel(x.route, language) || '', x.place || '', x.reaction || '']), [60, 100, 60, 70, 90, W - 380]);
    }

    // milestones
    if (on('milestones') && milestones.rows.length) {
      section(say(allMilestones ? 'milestones.titleAll' : 'milestones.title'));
      table([say('col.date'), say('col.what'), say('col.assessment')], milestones.rows.map((m) => [fmtShort(m.date), { text: milestoneTitle(m.kind, m.title, language), bold: true }, { text: say(m.tone === 'positive' ? 'milestones.good' : m.tone === 'negative' ? 'milestones.bad' : 'milestones.neutral'), color: m.tone === 'positive' ? C.accent : m.tone === 'negative' ? C.danger : C.fg2 }]), [70, W - 190, 120]);
    }

    // imaging
    if (on('imaging') && studyList.length) {
      section(say('imaging.title'));
      const last = studyList[studyList.length - 1];
      para(say('imaging.last', { study: `${modalityLabel(last.modality, language)}${last.region ? ` ${last.region}` : ''}`, date: fmtDay(last.date), response: last.response ? say('imaging.response', { response: responseLabel(last.response, language) }) : '' }));
      if (last.impression) { doc.moveDown(0.2); para(last.impression); }
      if (recist.length) {
        doc.moveDown(0.3);
        table([say('col.date'), say('col.lesions'), say('col.sum'), say('col.fromBaseline'), 'RECIST 1.1'], recist.slice(-8).map((r) => [fmtShort(r.date), String(r.lesionCount), r.sum == null ? '—' : String(r.sum), r.changeFromBaselinePct == null || r.response === 'baseline' ? '—' : `${r.changeFromBaselinePct > 0 ? '+' : ''}${r.changeFromBaselinePct}%`, { text: responseLabel(r.response, language), color: r.response === 'PD' ? C.danger : r.response === 'PR' || r.response === 'CR' ? C.accent : C.fg, bold: true }]), [80, 70, 90, 100, W - 340]);
        const targets = lesions.rows.filter((l) => l.is_target && !l.retired);
        if (targets.length) {
          const recent = studyList.slice(-5);
          const sizeOf = (lid, sid) => { const m = meas.rows.find((x) => x.lesion_id === lid && x.study_id === sid); return m?.size_mm != null ? fmtNum(m.size_mm) : '—'; };
          table([say('col.lesion'), ...recent.map((s) => fmtShort(s.date))], targets.map((l) => [{ text: l.name + (l.location ? ` · ${l.location}` : ''), bold: true }, ...recent.map((s) => sizeOf(l.id, s.id))]), [W - 70 * recent.length, ...recent.map(() => 70)]);
          muted(say('imaging.sizes'));
        }
      }
    }

    // labs
    if (on('labs')) {
    section(say('labs.title'));
    para(say('labs.intro', { n: docs.rows[0].n, scope: say(allLabs ? 'labs.scopeAll' : 'labs.scopeKey') }));
    doc.moveDown(0.3);
    if (labRows.length) {
      table([say('col.marker'), say('col.latest'), say('col.date'), say('col.previous'), say('col.range'), say('col.unit')], labRows.map((r) => [
        { text: r.name, bold: true },
        { text: r.last, bold: true, color: r.flag === 'high' || r.flag === 'low' ? C.warn : r.flag === 'ok' ? C.accent : C.fg },
        fmtShort(r.lastDate), r.prev + (r.prevDate ? ` (${fmtShort(r.prevDate)})` : ''), r.ref, r.unit,
      ]), [116, 66, 58, 104, 84, W - 428]);
      muted(say('labs.legend'));
    } else {
      para(say('labs.none'));
    }
    }

    // symptoms
    if (on('symptoms')) {
    section(say('symptoms.title'));
    if (S.length) {
      const lines = [say('symptoms.entries', { n: S.length, days: dayRange(from, to).length })];
      if (bpS.length) lines.push(say('symptoms.bp', { avgS: avg(bpS), avgD: avg(bpD), maxS: Math.max(...bpS), maxD: Math.max(...bpD), days: S.filter((e) => e.bp_sys >= 140 || e.bp_dia >= 90).length }));
      if (weights.length) lines.push(say('symptoms.weight', { from: fmtNum(body.weight(weights[0])), to: fmtNum(body.weight(weights[weights.length - 1])), unit: body.weightUnit }));
      if (S.some((e) => e.temp_c != null && Number(e.temp_c) >= 37.5)) lines.push(say('symptoms.fever', { limit: `${fmtNum(body.temperature(37.5))}${f.temperature === 'f' ? ` ${body.temperatureUnit}` : ''}`, n: S.filter((e) => e.temp_c != null && Number(e.temp_c) >= 37.5).length }));
      if (S.some((e) => e.wellbeing != null)) lines.push(say('symptoms.wellbeing', { avg: avg(S.filter((e) => e.wellbeing != null).map((e) => e.wellbeing)) }));
      para(lines.join(' '));
      if (scales.length) {
        doc.moveDown(0.3);
        table([say('col.symptom'), say('col.daysModerate'), say('col.highest')], scales.map((s) => [{ text: s.label, bold: true }, String(s.days), String(s.max)]), [200, 160, W - 360]);
      }
      const notes = S.filter((e) => e.notes).slice(-6);
      if (notes.length) { doc.moveDown(0.2); muted(say('symptoms.notes', { text: notes.map((e) => `${fmtShort(new Date(e.date).toISOString().slice(0, 10))}: ${e.notes}`).join(' · ') })); }
    } else {
      para(say('symptoms.none'));
    }
    }

    // alerts
    if (on('alerts') && alerts.rows.length) {
      section(say('alerts.title'));
      table([say('col.date'), say('col.what'), say('col.status')], alerts.rows.slice(0, 15).map((a) => [fmtShort(dayOf(a.triggered_at, tz)), { text: `${a.context?.severity === 'RED' ? '● ' : '○ '}${a.context?.message ? alertMessage(a.context, f) : ''}`, color: a.context?.severity === 'RED' ? C.danger : C.warn }, say(a.status === 'OPEN' ? 'alerts.open' : 'alerts.read')]), [70, W - 150, 80]);
    }

    // documents: brief annotations of files attached to milestones (made with «Кратко (ИИ)»)
    if (on('documents')) {
      const docsQ = allMilestones
        ? pool.query(`select m.date::text as date, m.title, a.filename, e.summary from milestones m join attachments a on a.event_id = m.event_id join attachment_extracts e on e.user_id = m.user_id and e.sha256 = a.sha256 where m.user_id = $1 and e.summary is not null order by m.date`, [userId])
        : pool.query(`select m.date::text as date, m.title, a.filename, e.summary from milestones m join attachments a on a.event_id = m.event_id join attachment_extracts e on e.user_id = m.user_id and e.sha256 = a.sha256 where m.user_id = $1 and m.date between $2 and $3 and e.summary is not null order by m.date`, [userId, from, to]);
      const ds = (await docsQ).rows;
      if (ds.length) {
        section(say('documents.title'));
        muted(say('documents.note'));
        for (const d of ds) { doc.moveDown(0.3); ensure(30); doc.font('Inter-SemiBold').fontSize(10).fillColor(C.fg).text(`${fmtShort(d.date)} · ${d.title}${d.filename ? ` · ${d.filename}` : ''}`, { width: W }); para(d.summary.trim()); }
      }
    }

    // footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // footer sits inside the bottom margin; keep pdfkit from adding a page
      pdfBrandLine(doc, (site) => say('brandLine', { site }), 44, doc.page.height - 38, W, C.accent);
      doc.font('Inter').fontSize(7.5).fillColor(C.fg3).text(say('footer', { page: i + 1, pages: range.count }), 44, doc.page.height - 27, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
    const buf = await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(say('fileName', { from, to }))}`);
    return reply.send(buf);
  });
}
