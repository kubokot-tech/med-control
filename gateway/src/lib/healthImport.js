/**
 * Apple Health data arriving from the phone: Health Auto Export JSON (REST automation), the same shape
 * from a Shortcut, or the one-off export.xml. Samples are kept raw in health_samples and folded into the
 * symptom diary per day (blood pressure, weight, temperature, pulse, steps), which runs the alert rules.
 */
import { pool } from './db.js';
import { dayKey, DEFAULT_TZ } from './dates.js';
import { saveSymptoms } from './symptoms.js';
import { getSetting, setSetting } from './settings.js';
import { parseHealthDate } from './healthParse.js';

export { parseHealthDate, parseHealthAutoExport, parseHealthXml } from './healthParse.js';

/** Store samples (idempotent) and fold them into the diary. Returns a summary. */
export async function importSamples(userId, samples, { tz = DEFAULT_TZ, source = 'health_auto_export' } = {}) {
  let inserted = 0;
  for (const s of samples) {
    const r = await pool.query('insert into health_samples (user_id, kind, ts, value, source) values ($1,$2,$3,$4,$5) on conflict (user_id, kind, ts) do update set value = excluded.value where health_samples.value is distinct from excluded.value returning (xmax = 0) as fresh', [userId, s.kind, s.ts, JSON.stringify(s.value), source]);
    // daily aggregates (steps, pulse) arrive again with the same timestamp and a bigger value: update them
    if (r.rows[0]?.fresh) inserted++;
  }
  const days = new Set(samples.filter((s) => ['blood_pressure', 'weight_body_mass', 'body_temperature', 'heart_rate', 'resting_heart_rate', 'step_count'].includes(s.kind)).map((s) => dayKey(s.ts, tz)));
  const today = dayKey(new Date(), tz);
  let alertsRaised = 0; let daysUpdated = 0;
  for (const day of [...days].sort()) {
    if (day > today) continue;
    const e = await diaryFieldsForDay(userId, day, tz);
    if (!Object.keys(e).length) continue;
    const cur = (await pool.query('select bp_sys, bp_dia from symptom_entries where user_id = $1 and date = $2', [userId, day])).rows[0];
    // pulse and steps alone do not create a diary day; they enrich days that have readings or entries
    if (!cur && e.bpSys == null && e.weightKg == null && e.tempC == null) continue;
    // a higher reading entered by hand wins over the device
    if (cur?.bp_sys != null && e.bpSys != null && cur.bp_sys > e.bpSys) { delete e.bpSys; delete e.bpDia; }
    if (!Object.keys(e).length) continue;
    const r = await saveSymptoms(userId, day, e, tz);
    alertsRaised += r.alertsRaised; daysUpdated++;
  }
  const summary = { at: new Date().toISOString(), source, samples: samples.length, inserted, days: daysUpdated, alertsRaised, kinds: [...new Set(samples.map((s) => s.kind))] };
  await setSetting('health_last_import', JSON.stringify(summary));
  return summary;
}

/** Diary fields for one day from all stored samples of that day: the highest blood pressure reading (alerts must not miss a morning spike), last weight, max temperature, resting or average pulse, steps summed. */
export async function diaryFieldsForDay(userId, day, tz = DEFAULT_TZ) {
  // range on ts (uses the index), day boundaries in the user's time zone
  const r = await pool.query(`select kind, ts, value from health_samples where user_id = $1 and ts >= ($3::date)::timestamp at time zone $2 and ts < ($3::date + 1)::timestamp at time zone $2 order by ts`, [userId, tz, day]);
  const by = (k) => r.rows.filter((x) => x.kind === k);
  const e = {};
  const bp = by('blood_pressure').reduce((best, x) => (!best || x.value.systolic >= best.value.systolic ? x : best), null);
  if (bp) { e.bpSys = Math.round(bp.value.systolic); e.bpDia = Math.round(bp.value.diastolic); }
  const w = by('weight_body_mass').at(-1);
  if (w) e.weightKg = Math.round(w.value.qty * 10) / 10;
  const t = by('body_temperature');
  if (t.length) e.tempC = Math.round(Math.max(...t.map((x) => x.value.qty)) * 10) / 10;
  const rhr = by('resting_heart_rate').at(-1);
  const hr = by('heart_rate');
  if (rhr) e.pulse = Math.round(rhr.value.qty);
  else if (hr.length) e.pulse = Math.round(hr.reduce((a, x) => a + x.value.avg, 0) / hr.length);
  const st = by('step_count');
  if (st.length) e.steps = Math.round(st.reduce((a, x) => a + x.value.qty, 0));
  return e;
}

export function lastImport() {
  try { return JSON.parse(getSetting('health_last_import') || 'null'); } catch { return null; }
}
export async function healthStatus(userId) {
  const r = await pool.query('select kind, count(*)::int as n, max(ts) as last from health_samples where user_id = $1 group by kind order by kind', [userId]);
  return { lastImport: lastImport(), kinds: r.rows };
}

