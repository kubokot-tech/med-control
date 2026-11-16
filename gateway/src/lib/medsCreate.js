/** Create a medication with its daily regimen (systemic or support). Shared by the meds API and the protocol seed. */
import { pool, transaction } from './db.js';
import { DEFAULT_TZ, todayKey } from './dates.js';
import { addEvent } from './feed.js';
import { normalizeSchedule } from './schedule.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

/** b: { name, role, form?, doseValue?, doseUnit?, timesPerDay?, remindAt?, instructions?, startDate?, frequencyRule?, scheduleDays?, intervalDays? } (validated by the caller). */
export async function createMedication(userId, b, tz = DEFAULT_TZ) {
  const name = b.name.trim();
  const role = b.role || 'support';
  const startDate = b.startDate || todayKey(tz);
  const sch = normalizeSchedule({ frequencyRule: b.frequencyRule, scheduleDays: b.scheduleDays, intervalDays: b.intervalDays, startDate });
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const m = await client.query('insert into medications (user_id, name, form, role, instructions, sort_order) values ($1,$2,$3,$4,$5,$6) returning id', [userId, name, b.form || null, role, b.instructions || null, role === 'systemic' ? 10 : 100]);
    const r = await client.query('insert into regimens (user_id, name, start_date) values ($1,$2,$3) returning id', [userId, name, startDate]);
    const ri = await client.query(`insert into regimen_items (regimen_id, medication_id, dose_value, dose_unit, route, frequency_rule, schedule_days, interval_days, time_windows, prn, remind_at, times_per_day) values ($1,$2,$3,$4,'po',$5,$6,$7,'{}'::jsonb,false,$8,$9) returning id`,
      [r.rows[0].id, m.rows[0].id, b.doseValue ?? null, b.doseUnit || null, sch.frequencyRule, sch.scheduleDays, sch.intervalDays, b.remindAt || null, b.timesPerDay || 1]);
    if (b.doseValue != null) await client.query('insert into dose_changes (user_id, regimen_item_id, effective_from, dose_value, dose_unit, reason) values ($1,$2,$3,$4,$5,$6)', [userId, ri.rows[0].id, startDate, b.doseValue, b.doseUnit || null, 'назначение']);
    await addEvent(client, userId, { type: 'NOTE', date: startDate, time: '12:00', tz, title: t(language, 'feedTitles.medStart', { name: `${name}${b.doseValue != null ? ` ${b.doseValue} ${b.doseUnit || ''}` : ''}` }), notes: b.instructions || null, meta: { what: 'medication_start', medicationId: m.rows[0].id }, source: 'meds' });
    return { ok: true, medicationId: m.rows[0].id, regimenItemId: ri.rows[0].id };
  });
}

/** True when an active regimen with a systemic medication exists. */
export async function hasActiveSystemic(userId) {
  const r = await pool.query(`select 1 from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id
    where r.user_id = $1 and m.role = 'systemic' and (r.end_date is null or r.end_date > now()) limit 1`, [userId]);
  return r.rows.length > 0;
}
