/** Symptom diary: one entry per day, mirrored as a SYMPTOM feed event, alert rules on save. */
import { pool, transaction } from './db.js';
import { addEvent } from './feed.js';
import { DEFAULT_TZ, todayKey, addDays } from './dates.js';
import { symptomFindings, raiseAlerts } from './alerts.js';
import { SCALE_KEYS, SCALE_CATALOG, SCALE_COLUMNS, JSONB_SCALE_KEYS, scaleShort } from './diaryScales.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { rowToEntry } from './symptomRow.js';
import { displayUnit } from '../../../shared/units.js';

// Plain fields plus the scales that have their own column; the other scales go to the jsonb column `scales`.
export const COLS = {
  wellbeing: 'wellbeing', ...SCALE_COLUMNS,
  tempC: 'temp_c', bpSys: 'bp_sys', bpDia: 'bp_dia', weightKg: 'weight_kg', pulse: 'pulse', steps: 'steps', notes: 'notes',
};
export const SCALE_LABELS = Object.fromEntries(SCALE_CATALOG.map((x) => [x.key, x.short]));

export { rowToEntry };

/**
 * Short summary for the timeline event title and bot replies, in `language`. `body` (bodyUnits) and `number` show weight
 * and temperature in the user's units; without them, as stored: kg and °C.
 */
export function summarize(e, language, { body, number = String } = {}) {
  const say = (key, args) => t(language, `feedTitles.${key}`, args);
  const parts = [];
  if (e.wellbeing != null) parts.push(say('summaryWellbeing', { n: e.wellbeing }));
  if (e.bpSys != null && e.bpDia != null) parts.push(say('summaryBp', { sys: e.bpSys, dia: e.bpDia }));
  if (e.weightKg != null) parts.push(say('summaryWeight', { value: number(body ? body.weight(e.weightKg) : e.weightKg), unit: body?.weightUnit ?? displayUnit('кг', language) }));
  if (e.tempC != null) parts.push(say('summaryTemp', { value: number(body ? body.temperature(e.tempC) : e.tempC), unit: body?.temperatureUnit ?? '°C' }));
  if (e.pulse != null) parts.push(say('summaryPulse', { n: e.pulse }));
  for (const k of SCALE_KEYS) {
    if (e[k] != null && e[k] >= 2) parts.push(say('summaryScale', { label: scaleShort(k, language), n: e[k] }));
  }
  return parts.join(' · ') || say('summaryEmpty');
}

/**
 * Upsert the fields given in `e` (camelCase keys of COLS) for `date`; replaces the day's SYMPTOM event.
 * opts.appendNotes: add to the day's note instead of replacing it (Telegram lines).
 * Alerts are raised only for the last two days: importing years of history must not page the owner.
 */
export async function saveSymptoms(userId, date, e, tz = DEFAULT_TZ, opts = {}) {
  if (opts.appendNotes && e.notes) {
    const cur = await pool.query('select notes from symptom_entries where user_id = $1 and date = $2', [userId, date]);
    const prev = cur.rows[0]?.notes;
    if (prev && !prev.includes(e.notes)) e = { ...e, notes: `${prev}; ${e.notes}` };
  }
  const keys = Object.keys(COLS).filter((k) => k in e);
  const extraKeys = JSONB_SCALE_KEYS.filter((k) => k in e);
  if (!keys.length && !extraKeys.length) { const err = new Error('nothing to save'); err.code = 'nothing_to_save'; throw err; }
  const cols = keys.map((k) => COLS[k]);
  const vals = keys.map((k) => e[k] ?? null);
  // jsonb scales: merged into the day's object, a null removes the key
  if (extraKeys.length) { cols.push('scales'); vals.push(JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, e[k] ?? null])))); }
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const placeholders = cols.map((c, i) => (c === 'scales' ? `jsonb_strip_nulls($${i + 3}::jsonb)` : `$${i + 3}`)).join(', ');
    const updates = cols.map((c, i) => (c === 'scales' ? `scales = jsonb_strip_nulls(symptom_entries.scales || $${i + 3}::jsonb)` : `${c} = $${i + 3}`)).join(', ');
    const r = await client.query(
      `insert into symptom_entries (user_id, date, ${cols.join(', ')}) values ($1, $2, ${placeholders})
       on conflict (user_id, date) do update set ${updates}, updated_at = now() returning *`,
      [userId, date, ...vals]
    );
    const entry = rowToEntry(r.rows[0]);
    await client.query(`delete from events where user_id = $1 and type = 'SYMPTOM' and to_char(occurred_at at time zone $2, 'YYYY-MM-DD') = $3`, [userId, tz, date]);
    await addEvent(client, userId, { type: 'SYMPTOM', date, tz, title: t(language, 'feedTitles.symptom', { summary: summarize(entry, language) }), notes: entry.notes || null, meta: { date }, source: 'symptoms' });
    const recent = date >= addDays(todayKey(tz), -2);
    const alertsRaised = recent ? await raiseAlerts(client, userId, symptomFindings(entry, date, language), new Date(`${date}T12:00:00Z`)) : 0;
    return { entry, alertsRaised };
  });
}
