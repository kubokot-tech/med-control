/**
 * Medications core: regimens list, medication edits, the administrations journal, dose changes and the calendar.
 * Recording one dose lives in medsRecord.js, adding a medication in medsCreate.js, the streak in medsStreak.js.
 * Inputs are already validated by the caller (routes/meds.js holds the HTTP schemas); expected failures are
 * CoreError (lib/errors.js).
 */
import { pool, transaction } from './db.js';
import { DEFAULT_TZ, todayKey, dayRange } from './dates.js';
import { activeItems, doseOn, dosesFor } from './medsRecord.js';
import { dosesPerDay, statusOfDay } from './medsDays.js';
import { addEvent, updateEvent, deleteEvent } from './feed.js';
import { scheduleFromRow, describeSchedule, isDoseDay, nextDoseDay, normalizeSchedule } from './schedule.js';
import { invalid, notFound } from './errors.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
export const ADMIN_STATUSES = ['TAKEN', 'SKIPPED', 'MISSED', 'PLANNED'];

/** Active regimens with their items; each item carries its schedule text, whether a dose is due today and the next dose day. */
export async function listRegimens(userId, { tz = DEFAULT_TZ, language } = {}) {
  const today = todayKey(tz);
  const r = await pool.query(
    `select r.id as regimen_id, r.name as regimen_name, r.start_date, r.end_date, r.notes as regimen_notes,
            m.id as med_id, m.name as med_name, m.form, m.strength, m.unit as med_unit, m.role, m.instructions,
            ri.id as item_id, ri.dose_value, ri.dose_unit, ri.route, ri.frequency_rule, ri.schedule_days, ri.interval_days, ri.time_windows, ri.prn, ri.remind_at, ri.times_per_day
     from regimens r
     join regimen_items ri on ri.regimen_id = r.id
     join medications m on m.id = ri.medication_id
     where r.user_id = $1 and (r.end_date is null or r.end_date > now())
     order by (m.role = 'systemic') desc, m.sort_order, r.start_date desc`,
    [userId]
  );
  // today's marks per medication: the page shows «принято 1 из 2» and marks the next dose
  const marks = await pool.query('select id, medication_id, dose_no, status, taken_at from administrations where user_id = $1 and day = $2::date order by dose_no', [userId, today]);
  const todayOf = (medId) => marks.rows.filter((x) => x.medication_id === medId).map((x) => ({ id: x.id, doseNo: x.dose_no, status: x.status, takenAt: x.taken_at }));
  const map = new Map();
  for (const row of r.rows) {
    if (!map.has(row.regimen_id)) {
      map.set(row.regimen_id, { id: row.regimen_id, name: row.regimen_name, startDate: row.start_date, endDate: row.end_date, notes: row.regimen_notes, items: [] });
    }
    const sch = scheduleFromRow(row);
    const item = { ...sch, startDate: String(row.start_date).slice(0, 10) };
    map.get(row.regimen_id).items.push({
      id: row.item_id,
      medication: { id: row.med_id, name: row.med_name, form: row.form, strength: row.strength, unit: row.med_unit, role: row.role, instructions: row.instructions },
      remindAt: row.remind_at, timesPerDay: dosesPerDay(row.times_per_day),
      today: (() => { const m = todayOf(row.med_id); return { marks: m, taken: m.filter((x) => x.status === 'TAKEN').length, status: statusOfDay(m, row.times_per_day) }; })(),
      doseValue: row.dose_value ? Number(row.dose_value) : null,
      doseUnit: row.dose_unit,
      route: row.route,
      ...sch, scheduleText: describeSchedule(item, language), dueToday: isDoseDay(item, today), nextDose: nextDoseDay(item, today),
      timeWindows: row.time_windows,
      prn: row.prn,
    });
  }
  return Array.from(map.values());
}

/** Rename, change role, instructions, reminder, schedule, or stop a medication (stop adds a feed note). */
export async function updateMedication(userId, id, b, { tz = DEFAULT_TZ } = {}) {
  const own = await pool.query('select id, name from medications where id=$1 and user_id=$2', [id, userId]);
  if (!own.rows.length) throw notFound('medication_not_found');
  const language = await userLanguage(userId);
  const sets = []; const vals = [id];
  if (b.name !== undefined) { vals.push(b.name.trim()); sets.push(`name = $${vals.length}`); }
  if (b.role !== undefined) { vals.push(b.role); sets.push(`role = $${vals.length}`); vals.push(b.role === 'systemic' ? 10 : 100); sets.push(`sort_order = $${vals.length}`); }
  if (b.instructions !== undefined) { vals.push(b.instructions); sets.push(`instructions = $${vals.length}`); }
  if (sets.length) await pool.query(`update medications set ${sets.join(', ')} where id = $1`, vals);
  const isets = []; const ivals = [id];
  if (b.remindAt !== undefined) { ivals.push(b.remindAt); isets.push(`remind_at = $${ivals.length}`); }
  if (b.timesPerDay !== undefined) { ivals.push(b.timesPerDay); isets.push(`times_per_day = $${ivals.length}`); }
  if (b.frequencyRule !== undefined) {
    const cur = await pool.query(`select r.start_date::text as start_date from regimens r join regimen_items ri on ri.regimen_id = r.id where ri.medication_id = $1 order by r.start_date desc limit 1`, [id]);
    const sch = normalizeSchedule({ frequencyRule: b.frequencyRule, scheduleDays: b.scheduleDays, intervalDays: b.intervalDays, startDate: cur.rows[0]?.start_date || todayKey(tz) });
    ivals.push(sch.frequencyRule); isets.push(`frequency_rule = $${ivals.length}`);
    ivals.push(sch.scheduleDays); isets.push(`schedule_days = $${ivals.length}`);
    ivals.push(sch.intervalDays); isets.push(`interval_days = $${ivals.length}`);
  }
  if (isets.length) await pool.query(`update regimen_items set ${isets.join(', ')} where medication_id = $1`, ivals);
  if (b.stop) {
    const stopDate = b.stopDate || todayKey(tz);
    await pool.query(`update regimens r set end_date = $3 from regimen_items ri where ri.regimen_id = r.id and ri.medication_id = $1 and r.user_id = $2 and (r.end_date is null or r.end_date > $3::date)`, [id, userId, stopDate]);
    await addEvent(pool, userId, { type: 'NOTE', date: stopDate, time: '12:00', tz, title: t(language, 'feedTitles.medStop', { name: own.rows[0].name }), meta: { what: 'medication_stop', medicationId: id }, source: 'meds' });
  }
  return activeItems(userId);
}

/** The journal, newest first (at most 200), optionally for one medication and a day range in the user's zone. */
export async function listAdministrations(userId, { medicationId = null, from = '', to = '', tz = DEFAULT_TZ } = {}) {
  const where = ['a.user_id = $1'];
  const params = [userId];
  if (medicationId) { params.push(medicationId); where.push(`a.medication_id = $${params.length}`); }
  if (DAY_RX.test(from) || DAY_RX.test(to)) {
    params.push(tz);
    const dayExpr = `to_char(coalesce(a.taken_at, a.scheduled_for, a.created_at) at time zone $${params.length}, 'YYYY-MM-DD')`;
    if (DAY_RX.test(from)) { params.push(from); where.push(`${dayExpr} >= $${params.length}`); }
    if (DAY_RX.test(to)) { params.push(to); where.push(`${dayExpr} <= $${params.length}`); }
  }
  const r = await pool.query(
    `select a.id, a.medication_id, a.regimen_item_id, a.scheduled_for, a.taken_at, a.status, a.dose_no,
            a.dose_value, a.dose_unit, a.notes, a.created_at,
            to_char(coalesce(a.taken_at, a.scheduled_for, a.created_at) at time zone $${params.push(tz)}, 'YYYY-MM-DD') as day,
            m.name as med_name
     from administrations a
     join medications m on m.id = a.medication_id
     where ${where.join(' and ')}
     order by coalesce(a.taken_at, a.scheduled_for, a.created_at) desc
     limit ${DAY_RX.test(from) || DAY_RX.test(to) ? 2000 : 200}`, // a period (the calendar month) comes whole, up to 12 doses a day
    params
  );
  return r.rows.map((row) => ({
    id: row.id,
    medicationId: row.medication_id,
    regimenItemId: row.regimen_item_id,
    scheduledFor: row.scheduled_for,
    takenAt: row.taken_at,
    day: row.day,
    status: row.status,
    doseNo: row.dose_no,
    doseValue: row.dose_value ? Number(row.dose_value) : null,
    doseUnit: row.dose_unit,
    notes: row.notes,
    createdAt: row.created_at,
    medName: row.med_name,
  }));
}

/** Change the status (one of ADMIN_STATUSES; anything else is ignored) or the note of one record. */
export async function updateAdministration(userId, id, { status, notes } = {}) {
  const sets = [];
  const params = [userId, id];
  if (status && ADMIN_STATUSES.includes(status)) { params.push(status); sets.push(`status = $${params.length}`); }
  if (notes !== undefined) { params.push(notes); sets.push(`notes = $${params.length}`); }
  if (!sets.length) throw invalid('nothing_to_update');
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const r = await client.query(`update administrations set ${sets.join(', ')} where user_id = $1 and id = $2
      returning id, status, event_id, medication_id, notes, dose_no, expected_doses`, params);
    const mark = r.rows[0];
    if (!mark) throw notFound();
    if (mark.event_id) {
      const med = await client.query('select name from medications where id=$1', [mark.medication_id]);
      const meta = { status: mark.status, doseNo: mark.dose_no, times: mark.expected_doses };
      const title = t(language, mark.expected_doses > 1 ? 'feedTitles.medDose' : 'feedTitles.med',
        { name: med.rows[0].name, n: mark.dose_no, times: mark.expected_doses, status: mark.status });
      await updateEvent(client, userId, mark.event_id, { type: 'MED_ADMIN', title, notes: mark.notes, meta });
    }
    return { id: mark.id, status: mark.status };
  });
}

/** Dose history of a regimen item, newest first. */
export async function doseHistory(userId, regimenItemId) {
  const r = await pool.query(
    `select id, effective_from::text as effective_from, dose_value, dose_unit, reason, created_at
     from dose_changes where user_id = $1 and regimen_item_id = $2
     order by effective_from desc, created_at desc`,
    [userId, regimenItemId]
  );
  return r.rows.map((x) => ({ id: x.id, effectiveFrom: x.effective_from, doseValue: Number(x.dose_value), doseUnit: x.dose_unit, reason: x.reason, createdAt: x.created_at }));
}

/** Record a dose change; the regimen item takes the newest dose already in effect, and the feed gets a note. */
export async function changeDose(userId, { regimenItemId, effectiveFrom, doseValue, doseUnit, reason, tz = DEFAULT_TZ }) {
  const language = await userLanguage(userId);
  const item = await pool.query(
    `select ri.id, ri.dose_value, ri.dose_unit, m.name from regimen_items ri
     join regimens r on r.id = ri.regimen_id join medications m on m.id = ri.medication_id
     where ri.id = $1 and r.user_id = $2`,
    [regimenItemId, userId]
  );
  if (!item.rows.length) throw notFound('item_not_found');
  const prev = item.rows[0];
  const unit = doseUnit || prev.dose_unit || 'mg';
  return transaction(async (client) => {
    const ins = await client.query(
      `insert into dose_changes (user_id, regimen_item_id, effective_from, dose_value, dose_unit, reason)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [userId, regimenItemId, effectiveFrom, doseValue, unit, reason || null]
    );
    const latest = await client.query(
      `select dose_value, dose_unit from dose_changes where regimen_item_id = $1 and effective_from <= current_date order by effective_from desc, created_at desc limit 1`,
      [regimenItemId]
    );
    await client.query('update regimen_items set dose_value = $2, dose_unit = $3 where id = $1', [regimenItemId, latest.rows[0].dose_value, latest.rows[0].dose_unit]);
    const unitRu = language === 'ru' ? unit.replace(/^mg$/i, 'мг') : unit;
    const from = prev.dose_value != null ? Number(prev.dose_value) : null;
    await addEvent(client, userId, { type: 'NOTE', date: effectiveFrom, tz, title: t(language, 'feedTitles.doseChange', { name: prev.name, from: from ?? '—', to: doseValue, unit: unitRu }), notes: reason || null, meta: { what: 'dose', from, to: doseValue, unit }, source: 'meds' });
    return { id: ins.rows[0].id, current: { doseValue: Number(latest.rows[0].dose_value), doseUnit: latest.rows[0].dose_unit } };
  });
}

export const MAX_CALENDAR_DAYS = 400;

/**
 * Calendar: one status (TAKEN, SKIPPED, PAUSED) for every day in a past range; CLEAR removes the marks. Every dose of
 * the day (times_per_day of the item) gets the status. Existing marks are updated in
 * place, extra ones removed, new ones get a feed event.
 */
export async function setDays(userId, { medicationId, regimenItemId = null, from, to, status, tz = DEFAULT_TZ }) {
  if (from > to) throw invalid('bad_range');
  if (to > todayKey(tz)) throw invalid('future', 'Будущие дни отмечать нельзя');
  const days = dayRange(from, to);
  if (days.length > MAX_CALENDAR_DAYS) throw invalid('too_many_days');
  const med = await pool.query('select id, name from medications where id=$1 and user_id=$2', [medicationId, userId]);
  if (!med.rows.length) throw notFound('medication_not_found');
  const medName = med.rows[0].name;
  const times = await dosesFor(userId, medicationId, regimenItemId);
  // a day set from the calendar is the whole day: every dose gets the status (a pause or a skip covers the evening dose too)
  const language = await userLanguage(userId);
  const titleOf = (n, times) => t(language, times > 1 ? 'feedTitles.medDose' : 'feedTitles.med', { name: medName, n, times, status });
  return transaction(async (client) => {
    const existing = await client.query(
      `select id, day::text as day, dose_no, event_id, expected_doses from administrations where user_id=$1 and medication_id=$2 and day between $3 and $4`,
      [userId, medicationId, from, to]
    );
    const byDay = new Map();
    for (const r of existing.rows) { if (!byDay.has(r.day)) byDay.set(r.day, new Map()); byDay.get(r.day).set(r.dose_no, r); }
    let updated = 0, inserted = 0, deleted = 0;
    for (const day of days) {
      const rows = byDay.get(day) || new Map();
      const expected = rows.size ? Math.max(...[...rows.values()].map((r) => r.expected_doses)) : times;
      const wanted = status === 'CLEAR' ? [] : Array.from({ length: expected }, (_, i) => i + 1);
      for (const [n, row] of rows) {
        if (wanted.includes(n)) continue;
        await client.query('delete from administrations where id=$1', [row.id]);
        await deleteEvent(client, userId, row.event_id);
        deleted++;
      }
      if (!wanted.length) continue;
      const du = status === 'TAKEN' ? await doseOn(regimenItemId, day) : { doseValue: null, doseUnit: null };
      for (const n of wanted) {
        const row = rows.get(n);
        if (row) {
          await client.query(`update administrations set status=$2::admin_status, taken_at=(($3::date || ' 12:00')::timestamp at time zone $4), day=$3, dose_value=coalesce($5, case when $2::text = 'TAKEN' then dose_value end), dose_unit=coalesce($6, case when $2::text = 'TAKEN' then dose_unit end) where id=$1`, [row.id, status, day, tz, du.doseValue, du.doseUnit]);
          if (row.event_id) await updateEvent(client, userId, row.event_id, { title: titleOf(n, expected), meta: { status, doseNo: n, times: expected } });
          updated++;
        } else {
          const eventId = await addEvent(client, userId, { type: 'MED_ADMIN', date: day, time: '12:00', tz, title: titleOf(n, expected), notes: 'календарь', meta: { status, doseNo: n, times: expected }, source: 'calendar' });
          await client.query(
            `insert into administrations (user_id, medication_id, regimen_item_id, taken_at, day, dose_no, status, dose_value, dose_unit, notes, event_id, expected_doses)
             values ($1,$2,$3,(($4::date || ' 12:00')::timestamp at time zone $5),$4,$6,$7,$8,$9,'календарь',$10,$11)`,
            [userId, medicationId, regimenItemId || null, day, tz, n, status, du.doseValue, du.doseUnit, eventId, expected]
          );
          inserted++;
        }
      }
    }
    return { days: days.length, inserted, updated, deleted };
  });
}
