/**
 * Demo data: a fictional patient with endometriosis and eight months of history on hormonal therapy, written through the same code paths
 * as real use (lab PDFs through commitParsed, everything else through the HTTP API of the running gateway).
 * Dates are relative to today, so the demo always looks current.
 *
 *   docker compose exec -u node gateway node src/tools/demoSeed.js           # refuses if labs already exist
 *   docker compose exec -u node gateway node src/tools/demoSeed.js --force   # adds on top of existing data
 *
 * Every name, value, place and document here is invented. Nothing is taken from a real patient.
 */
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigner } from 'fast-jwt';
import { pool } from '../lib/db.js';
import { loadSettings, getSetting } from '../lib/settings.js';
import { loadCatalog } from '../lib/canonical.js';
import { resolveJwtSecret } from '../lib/config.js';
import { setupNeeded, USER_ID } from '../lib/setup.js';
import { commitParsed } from '../lib/labsCommit.js';
import { createNote } from '../lib/notes.js';
import { todayKey, addDays } from '../lib/dates.js';
import { getUserLocale } from '../lib/userLocale.js';
import { DEMO } from './demoTexts.js';

const API = process.env.DEMO_API || 'http://127.0.0.1:3000';
// Set in main() from the user's settings: the demo speaks the language it was installed in.
let TZ = 'Europe/Moscow';
let L = DEMO.ru;
const FONT_DIR = fileURLToPath(new URL('../../fonts/', import.meta.url));
const force = process.argv.includes('--force');

// Deterministic pseudo-random numbers: the same demo every run.
let seed = 20260302;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const jitter = (v, spread) => Math.round((v + (rnd() - 0.5) * 2 * spread) * 10) / 10;

let token = '';
async function api(method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// ---------- labs ----------
const LABS = [
  // ref low, ref high, values for the nine draws (see LAB_DAYS); names and units in L.labs, same order
  [120, 150, [98, 102, 105, 118, 124, 127, 128, 129, 131]],
  [3.8, 5.1, [3.9, 4.0, 4.0, 4.2, 4.3, 4.4, 4.4, 4.4, 4.5]],
  [80, 100, [74, 75, 76, 80, 83, 85, 86, 86, 87]],
  [4.0, 9.0, [5.8, 6.1, 5.6, 5.9, 6.2, 5.7, 6.0, 5.9, 5.8]],
  [150, 400, [412, 398, 385, 340, 310, 295, 288, 292, 290]],
  [15, 150, [6, 8, 9, 138, 121, 104, 92, 84, 76]],
  [9, 30.4, [4.8, 5.6, 6.1, 14.2, 15.8, 16.4, 15.1, 15.6, 16.9]],
  [0, 35, [18, 22, 31, 44, 38, 29, 24, 23, 22]],
  [0, 35, [20, 21, 26, 33, 30, 25, 23, 22, 22]],
  [3.9, 6.1, [4.9, 5.1, 4.8, 5.0, 5.2, 4.9, 5.0, 5.1, 4.9]],
  [3.0, 5.2, [4.6, 4.7, 4.9, 5.4, 5.3, 5.1, 5.0, 5.0, 4.9]],
  [0.4, 4.0, [1.8, 1.9, 2.1, 2.0, 1.7, 1.9, 2.2, 2.1, 2.0]],
  [0, 5, [6.2, 4.1, 3.0, 2.2, 1.8, 2.4, 1.6, 1.7, 1.5]],
];
// Day 213 is 32 days ago: the month the prepared «month in review» is written for always has a report.
const LAB_DAYS = [-25, 20, 55, 90, 125, 160, 190, 213, 238];

function labPdf({ date, lab, rows }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: L.pdf.title(date) } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('Inter', path.join(FONT_DIR, 'Inter-Regular.ttf'));
    doc.registerFont('Inter-Bold', path.join(FONT_DIR, 'Inter-Bold.ttf'));
    doc.font('Inter-Bold').fontSize(16).text(lab);
    doc.font('Inter').fontSize(10).fillColor('#555').text(L.pdf.disclaimer);
    doc.moveDown(0.6).fillColor('#000').fontSize(11).text(L.pdf.patient(date));
    doc.moveDown(0.8);
    const x = [48, 290, 370, 440];
    doc.font('Inter-Bold').fontSize(10);
    const hy = doc.y;
    L.pdf.headers.forEach((h, i) => doc.text(h, x[i], hy, { lineBreak: false }));
    doc.x = x[0]; doc.y = hy; doc.moveDown(1.4);
    doc.font('Inter');
    for (const r of rows) {
      const y = doc.y;
      const out = r.value < r.low || r.value > r.high;
      doc.fillColor(out ? '#b42318' : '#000');
      doc.text(r.name, x[0], y, { width: 235, lineBreak: false });
      doc.text(L.pdf.number(r.value), x[1], y, { lineBreak: false });
      doc.fillColor('#000').text(r.unit, x[2], y, { lineBreak: false });
      doc.text(`${L.pdf.number(r.low)}–${L.pdf.number(r.high)}`, x[3], y, { lineBreak: false });
      doc.x = x[0]; doc.y = y; doc.moveDown(1.3);
    }
    doc.end();
  });
}

async function seedLabs(start) {
  let docs = 0, results = 0, alerts = 0;
  for (let i = 0; i < LAB_DAYS.length; i++) {
    const date = addDays(start, LAB_DAYS[i]);
    if (date >= todayKey(TZ)) break;
    const lab = L.labNames[i % 2];
    const rows = LABS.map(([low, high, vals], k) => ({ name: L.labs[k][0], unit: L.labs[k][1], low, high, value: vals[i] }));
    const buf = await labPdf({ date, lab, rows });
    const parsed = {
      source: 'ai_pdf_v1', lab_name: lab, doc_date: date,
      observations: rows.map((r) => ({ test_name_raw: r.name, result_num: r.value, result_text: L.pdf.number(r.value), unit_raw: r.unit, ref_text_raw: `${r.low}-${r.high}`, ref_low: r.low, ref_high: r.high })),
    };
    const out = await commitParsed({ userId: USER_ID, buf, filename: L.labFile(date), parsed });
    docs += out.already ? 0 : 1; results += out.inserted; alerts += out.alertsRaised || 0;
  }
  return { docs, results, alerts };
}

// ---------- everything else through the API ----------
async function seedHistory(start) {
  const today = todayKey(TZ);
  const d = (n) => addDays(start, n);

  await api('POST', '/protocol/preset', { preset: 'endometriosis' });
  await api('PUT', '/ai/settings', { anamnesis: L.anamnesis, source: 'manual', note: L.anamnesisNote });
  await api('PUT', '/settings/patient', { ...L.patient, keptBy: 'self', birthDate: addDays(today, -(34 * 365 + 130)) });

  // Milestones before the therapy
  const milestones = [
    [-760, 'consult', 'neutral'],
    [-740, 'imaging', 'neutral'],
    [-380, 'imaging', 'negative'],
    [-25, 'other', 'negative'],
    [-10, 'consult', 'neutral'],
  ];
  for (const [i, [n, kind, tone]] of milestones.entries()) await api('POST', '/milestones', { date: d(n), kind, tone, title: L.milestones[i][0], notes: L.milestones[i][1] });

  // Medications: the hormone every day, iron tablets until the infusions, vitamin D
  const dieno = await api('POST', '/meds/medications', { name: L.dienogest.name, role: 'systemic', doseValue: 2, doseUnit: L.mg, timesPerDay: 1, remindAt: '21:00', instructions: L.dienogest.instructions, startDate: d(0), form: 'tablet' });
  const iron = await api('POST', '/meds/medications', { name: L.iron.name, role: 'support', doseValue: 80, doseUnit: L.mg, timesPerDay: 1, remindAt: '08:00', instructions: L.iron.instructions, startDate: d(-25) });
  const vitD = await api('POST', '/meds/medications', { name: L.vitaminD.name, role: 'support', doseValue: 2000, doseUnit: L.iu, timesPerDay: 1, remindAt: '09:00', instructions: L.vitaminD.instructions, startDate: d(30) });
  await api('POST', '/meds/doses', { regimen_item_id: iron.regimenItemId, effective_from: d(22), dose_value: 160, dose_unit: L.mg, reason: L.iron.reason });

  // Administrations: taken every day with a few skipped days; today stays open.
  const last = addDays(today, -1);
  const ranges = (med, from, to, status) => api('PUT', '/meds/administrations/days', { medication_id: med, from, to, status });
  await ranges(dieno.medicationId, d(0), last, 'TAKEN');
  for (const n of [41, 122, 189]) if (d(n) <= last) await ranges(dieno.medicationId, d(n), d(n), 'SKIPPED');
  await ranges(iron.medicationId, d(-25), d(69), 'TAKEN');
  await ranges(vitD.medicationId, d(30), last, 'TAKEN');
  await api('PATCH', `/meds/medications/${iron.medicationId}`, { stop: true, stopDate: d(69) });

  // Imaging: a baseline and three follow-up ultrasounds. The cysts are followed by size; RECIST is for tumours, so no target lesions.
  const studies = [
    [-15, L.impressions[0], [42, 19]],
    [85, L.impressions[1], [37, 17]],
    [170, L.impressions[2], [33, 15]],
    [232, L.impressions[3], [30, 14]],
  ];
  const lesions = [];
  for (const [name, location] of L.lesions) lesions.push((await api('POST', '/imaging/lesions', { name, location, isTarget: false })).lesion.id);
  let lastStudy = null;
  for (const [n, impression, sizes] of studies) {
    if (d(n) > today) continue;
    const s = (await api('POST', '/imaging/studies', { date: d(n), modality: 'УЗИ', region: L.studyRegion, impression, response: null })).study;
    await api('PUT', `/imaging/studies/${s.id}/measurements`, { measurements: lesions.map((id, i) => ({ lesionId: id, sizeMm: sizes[i] })) });
    lastStudy = s;
  }

  // Iron: tablets did not work, two infusions a week apart; later the good news
  await api('POST', '/milestones', { date: d(66), kind: 'consult', tone: 'neutral', title: L.ironMilestone[0], notes: L.ironMilestone[1] });
  const agents = (await api('GET', '/infusions')).agents || [];
  const ironIv = agents[0];
  if (ironIv) {
    const course = (await api('POST', '/infusions/courses', { agentId: ironIv.id, title: L.course.title, plannedCount: 2, cadenceDays: 7, startDate: d(70) })).course;
    for (let i = 0; i < 2; i++) {
      await api('POST', '/infusions', { agentId: ironIv.id, date: d(70 + i * 7), time: '11:00', doseValue: 500, doseUnit: L.mg, durationMin: 20, route: 'в/в капельно', place: L.course.place, courseId: course?.id || null, reaction: i === 0 ? L.course.reaction : null });
    }
  }
  if (d(236) <= last) await api('POST', '/milestones', { date: d(236), kind: 'consult', tone: 'positive', title: L.goodMilestone[0], notes: L.goodMilestone[1] });

  // Diary: most days. Pain fades over the first months of therapy; fatigue and a fast pulse go with the anemia and
  // lift after the iron; nausea while on iron tablets.
  let diaryDays = 0;
  for (let n = -7; addDays(start, n) <= last; n++) {
    if (rnd() < 0.12) continue;
    const date = d(n);
    const anemic = n < 85;
    const e = {
      bpSys: Math.round(jitter(110, 4)), bpDia: Math.round(jitter(70, 3)),
      weightKg: jitter(62 + Math.max(0, n) * 0.004, 0.3),
      wellbeing: n < 0 ? 3 : anemic ? (rnd() < 0.4 ? 3 : 4) : rnd() < 0.1 ? 3 : rnd() < 0.2 ? 5 : 4,
      pain: n < 60 ? (rnd() < 0.35 ? 2 : 1) : n < 130 ? (rnd() < 0.35 ? 1 : 0) : rnd() < 0.08 ? 1 : 0,
      fatigue: anemic ? (rnd() < 0.6 ? 2 : 1) : n < 120 ? (rnd() < 0.5 ? 1 : 0) : rnd() < 0.15 ? 1 : 0,
      headache: n >= 0 && n < 45 ? (rnd() < 0.25 ? 1 : 0) : rnd() < 0.05 ? 1 : 0,
      nausea: n < 70 && rnd() < 0.3 ? 1 : 0,
      sleepQuality: rnd() < 0.12 ? 1 : 0,
      anxiety: n < 30 ? (rnd() < 0.3 ? 1 : 0) : rnd() < 0.08 ? 1 : 0,
      pulse: Math.round(jitter(anemic ? 82 : n < 110 ? 77 : 72, 5)),
    };
    if (L.diary[n]) e.notes = L.diary[n];
    await api('PUT', `/symptoms/${date}`, e);
    diaryDays++;
  }

  // Appointments: past visits closed, the next one planned with questions prepared
  const visits = [[-10, L.gynecologist, 'done'], [45, L.gynecologist, 'done'], [66, L.therapist, 'done'], [100, L.gynecologist, 'done'], [172, L.gynecologist, 'done'], [236, L.therapist, 'done']];
  for (const [n, doctor, status] of visits) {
    if (d(n) >= today) continue;
    const a = (await api('POST', '/appointments', { date: d(n), time: '11:00', doctor, place: L.visitPlace })).appointment;
    await api('PATCH', `/appointments/${a.id}`, { status });
  }
  // contacts: fictional, phone numbers in unused ranges; the gynecologist matches the appointments below
  for (const c of L.contacts) await api('POST', '/contacts', c);
  const next = (await api('POST', '/appointments', { date: addDays(today, 9), time: '10:30', doctor: L.gynecologist, place: L.visitPlace, notes: L.nextVisitNotes })).appointment;
  await pool.query('update appointments set questions = $3, questions_model = $4, questions_at = now(), questions_context = $5 where user_id = $1 and id = $2',
    [USER_ID, next.id, L.visitQuestions, L.model, L.contextNote]);

  // Notes, dated when they were written
  for (const { day, ...n } of L.notes) {
    if (d(day) > last) continue;
    const note = await createNote(USER_ID, n, { tz: TZ, date: d(day) });
    await pool.query(`update notes set created_at = ($2::date || ' 12:00')::timestamp at time zone $3, updated_at = ($2::date || ' 12:00')::timestamp at time zone $3 where id = $1`, [note.id, d(day), TZ]);
  }

  // Alerts from the first months were handled long ago
  await pool.query(`update alerts set status = 'RESOLVED' where user_id = $1 and triggered_at < now() - interval '45 days'`, [USER_ID]);

  // Prepared AI texts, marked as demo examples
  const ym = addDays(today, -32).slice(0, 7);
  await pool.query('insert into ai_comments (user_id, subject_type, subject_id, model, text, usage, context) values ($1,$2,$3,$4,$5,$6,$7)',
    [USER_ID, 'labs_month', ym, L.model, L.monthReview, '{}', L.contextNote]);
  if (lastStudy) await pool.query('insert into ai_comments (user_id, subject_type, subject_id, model, text, usage, context) values ($1,$2,$3,$4,$5,$6,$7)',
    [USER_ID, 'imaging_study', lastStudy.id, L.model, L.imagingComment, '{}', L.contextNote]);

  return { diaryDays, studies: studies.length, lesions: lesions.length };
}

async function main() {
  await loadCatalog(pool);
  await loadSettings();
  if (setupNeeded()) throw new Error('First run the setup: open the site and set a password.');
  const labs = (await pool.query('select count(*)::int as n from lab_results where user_id = $1', [USER_ID])).rows[0].n;
  if (labs > 0 && !force) throw new Error(`There are lab results already (${labs}). Demo data goes into an empty database; --force adds it on top.`);

  const locale = await getUserLocale(USER_ID);
  L = DEMO[locale.language] || DEMO.ru;
  TZ = locale.timeZone;

  const secret = resolveJwtSecret();
  const tv = Number(getSetting('token_version') || 0);
  token = createSigner({ key: secret, expiresIn: 3600_000 })({ sub: USER_ID, tz: TZ, tv });
  await api('GET', '/auth/me');

  const start = addDays(todayKey(TZ), -245);
  console.log(`demo: therapy start ${start}`);
  const labsOut = await seedLabs(start);
  console.log(`demo: labs ${labsOut.docs} documents, ${labsOut.results} results, ${labsOut.alerts} alerts`);
  const hist = await seedHistory(start);
  console.log(`demo: diary ${hist.diaryDays} days, ${hist.studies} imaging studies, ${hist.lesions} lesions`);
  console.log('demo: done');
}

main().then(() => pool.end()).catch(async (e) => { console.error(`demo: ${e.message}`); await pool.end().catch(() => {}); process.exit(1); });
