/**
 * Recording a dose: one row per dose (dose_no 1..times_per_day) per calendar day per medication, plus a feed event.
 * Shared by the API and the Telegram bot.
 */
import { pool, transaction, abort } from './db.js';
import { dayKey, DEFAULT_TZ } from './dates.js';
import { addEvent, deleteEvent } from './feed.js';
import { scheduleFromRow } from './schedule.js';
import { dosesPerDay, statusOfDay } from './medsDays.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

/** Dose in effect on `day` for a regimen item: the latest dose_changes row with effective_from <= day, else the item's dose. */
export async function doseOn(regimenItemId, day) {
  if (!regimenItemId) return { doseValue: null, doseUnit: null };
  const r = await pool.query(`select dose_value, dose_unit from dose_changes where regimen_item_id = $1 and effective_from <= $2::date order by effective_from desc, created_at desc limit 1`, [regimenItemId, day]);
  const x = r.rows[0] || (await pool.query('select dose_value, dose_unit from regimen_items where id = $1', [regimenItemId])).rows[0] || {};
  return { doseValue: x.dose_value != null ? Number(x.dose_value) : null, doseUnit: x.dose_unit || null };
}

const toItem = (x) => ({ regimenItemId: x.regimen_item_id, medicationId: x.medication_id, name: x.name, role: x.role, instructions: x.instructions, remindAt: x.remind_at, timesPerDay: Number(x.times_per_day || 1), doseValue: x.dose_value != null ? Number(x.dose_value) : null, doseUnit: x.dose_unit, startDate: x.start_date , ...scheduleFromRow(x) });
/** All active scheduled items (daily, weekly, every N days): the systemic drug first, then supporting medications. */
export async function activeItems(userId) {
  const r = await pool.query(
    `select ri.id as regimen_item_id, ri.medication_id, m.name, m.role, m.instructions, ri.remind_at, ri.times_per_day, ri.dose_value, ri.dose_unit, r.start_date::text as start_date,
            ri.frequency_rule, ri.schedule_days, ri.interval_days
       from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id
      where r.user_id = $1 and coalesce(ri.prn, false) = false and (r.end_date is null or r.end_date > now())
      order by (m.role = 'systemic') desc, m.sort_order, r.start_date desc`,
    [userId]
  );
  return r.rows.map(toItem);
}
/** The active daily item: a given medication, a name fragment, or the systemic drug by default. */
export async function activeDailyItem(userId, { medicationId, nameLike } = {}) {
  const items = await activeItems(userId);
  if (medicationId) return items.find((x) => x.medicationId === medicationId) || null;
  if (nameLike) { const q = String(nameLike).trim().toLowerCase(); return items.find((x) => x.name.toLowerCase().startsWith(q)) || items.find((x) => x.name.toLowerCase().includes(q)) || null; }
  return items[0] || null;
}

/** Dose marks of a medication on a day, by dose number: [{ id, doseNo, status, takenAt }]. */
export async function dayMarks(userId, medicationId, day) {
  const r = await pool.query('select id, dose_no, status, taken_at, expected_doses from administrations where user_id = $1 and medication_id = $2 and day = $3::date order by dose_no', [userId, medicationId, day]);
  return r.rows.map((x) => ({ id: x.id, doseNo: x.dose_no, status: x.status, takenAt: x.taken_at, expectedDoses: x.expected_doses }));
}

/** Doses a day for a medication: its regimen item (given or active), else 1. */
export async function dosesFor(userId, medicationId, regimenItemId = null) {
  const r = regimenItemId
    ? await pool.query('select times_per_day from regimen_items where id = $1', [regimenItemId])
    : { rows: (await activeItems(userId)).filter((x) => x.medicationId === medicationId).map((x) => ({ times_per_day: x.timesPerDay })) };
  return dosesPerDay(r.rows[0]?.times_per_day);
}

/** The day of a medication as a whole: { status (TAKEN | PARTIAL | SKIPPED | PAUSED), taken, times, marks } or null. */
export async function dayStatus(userId, medicationId, day) {
  const marks = await dayMarks(userId, medicationId, day);
  if (!marks.length) return null;
  const times = Math.max(...marks.map((mark) => mark.expectedDoses));
  return { id: marks[marks.length - 1].id, status: statusOfDay(marks, times), taken: marks.filter((m) => m.status === 'TAKEN').length, times, marks };
}

/**
 * Record TAKEN/SKIPPED for one dose on the day of takenAt: dose `doseNo`, or the first dose of the day not marked yet.
 * Returns { ok, id, date, doseNo, times, taken } or { already: { id, status }, date } when that dose (or every dose
 * of the day) is marked. source: 'web' | 'telegram' (goes to the event source for the feed).
 */
export async function recordDose(userId, { medicationId, regimenItemId, status, takenAt, doseValue, doseUnit, notes, doseNo = null, tz = DEFAULT_TZ, source = 'meds' }) {
  const med = await pool.query('select id, name from medications where id=$1 and user_id=$2', [medicationId, userId]);
  if (!med.rows.length) { const e = new Error('medication not found'); e.code = 'medication_not_found'; throw e; }
  const takenAtTs = takenAt || new Date().toISOString();
  const day = dayKey(new Date(takenAtTs), tz);
  const marks = await dayMarks(userId, medicationId, day);
  const times = marks.length ? Math.max(...marks.map((mark) => mark.expectedDoses)) : await dosesFor(userId, medicationId, regimenItemId);
  const already = async () => { const d = await dayStatus(userId, medicationId, day); return { already: { id: d?.id, status: d?.status, taken: d?.taken, times }, date: day }; };
  const used = new Set(marks.map((m) => m.doseNo));
  let slot = doseNo == null ? null : Number(doseNo);
  if (slot != null && (!Number.isInteger(slot) || slot < 1 || slot > times)) { const e = new Error('bad dose number'); e.code = 'bad_dose_no'; throw e; }
  if (slot == null) slot = Array.from({ length: times }, (_, i) => i + 1).find((n) => !used.has(n)) ?? null;
  if (slot == null || used.has(slot)) return already();
  const title = t(await userLanguage(userId), times > 1 ? 'feedTitles.medDose' : 'feedTitles.med', { name: med.rows[0].name, n: slot, times, status });
  const LOST_RACE = Symbol('lost race');
  const out = await transaction(async (client) => {
    const eventId = await addEvent(client, userId, { type: 'MED_ADMIN', occurredAt: takenAtTs, title, notes: notes || null, meta: { status, doseNo: slot, times }, source });
    const a = await client.query(
      `insert into administrations (user_id, medication_id, regimen_item_id, taken_at, day, dose_no, expected_doses, status, dose_value, dose_unit, notes, event_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (user_id, medication_id, day, dose_no) do nothing returning id`,
      [userId, medicationId, regimenItemId || null, takenAtTs, day, slot, times, status, doseValue ?? null, doseUnit ?? null, notes || null, eventId]
    );
    if (!a.rows.length) abort(LOST_RACE); // another writer recorded the same dose first: roll back our event too
    return { ok: true, id: a.rows[0].id, status, date: day, name: med.rows[0].name, doseNo: slot, times, taken: marks.filter((m) => m.status === 'TAKEN').length + (status === 'TAKEN' ? 1 : 0) };
  });
  if (out === LOST_RACE) return already();
  return out;
}

/** Undo a dose record and its feed row. */
/** Note on doses that migration 036 filled in for days marked before per-dose marks. */
const LEGACY_FILL = 'до отметок по приёмам';

export async function deleteDose(userId, id) {
  return transaction(async (client) => {
    const del = await client.query('delete from administrations where user_id = $1 and id = $2 returning event_id, taken_at, created_at, dose_no, notes', [userId, id]);
    if (!del.rows.length) abort(false);
    const d = del.rows[0];
    if (d.event_id) await deleteEvent(client, userId, d.event_id);
    // doses filled in by migration 036 have no event of their own: the one at the same time is dose 1's
    else if (d.dose_no === 1 && d.notes !== LEGACY_FILL) await client.query(`delete from events where user_id = $1 and type = 'MED_ADMIN' and occurred_at = $2`, [userId, del.rows[0].taken_at || del.rows[0].created_at]);
    return true;
  });
}
