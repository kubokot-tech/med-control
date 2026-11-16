/**
 * The one place that writes the `events` feed. Every domain module (labs, meds, milestones, imaging,
 * infusions, symptoms, appointments, AI reviews) goes through here so the feed stays consistent.
 * `db` is a pool or a client inside a transaction.
 */
import { DEFAULT_TZ } from './dates.js';
import { invalidateProfileCache } from './patientProfile.js';

const TAGS = {
  MED_ADMIN: (m) => ['meds', String(m.status || '').toLowerCase()],
  MILESTONE: (m) => ['milestone', m.kind || 'other', m.tone || 'neutral'],
  INFUSION: (m) => ['infusion', m.agent || ''],
  LAB_RESULT: () => ['labs', 'pdf'],
  SYMPTOM: () => ['symptoms'],
  NOTE: (m) => ['meds', m.what || 'note'],
};

/** occurred_at from a calendar day and optional 'HH:MM' in the user's zone. */
export function atDay(date, time = '12:00', tz = DEFAULT_TZ) {
  return { sql: `(($1::date || ' ' || $2)::timestamp at time zone $3)`, params: [date, time || '12:00', tz] };
}

/**
 * Insert an event. Either `occurredAt` (ISO/Date) or `date` (+ `time`, `tz`).
 * Returns the new event id.
 */
export async function addEvent(db, userId, { type, occurredAt, date, time, tz = DEFAULT_TZ, title, notes = null, meta = {}, source }) {
  invalidateProfileCache();
  const tags = (TAGS[type] || (() => []))(meta);
  if (occurredAt) {
    const r = await db.query(
      `insert into events (user_id, type, occurred_at, title, notes, tags, meta, source) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [userId, type, occurredAt, title, notes, JSON.stringify(tags), JSON.stringify(meta), source || null]
    );
    return r.rows[0].id;
  }
  const r = await db.query(
    `insert into events (user_id, type, occurred_at, title, notes, tags, meta, source)
     values ($1,$2,(($3::date || ' ' || $4)::timestamp at time zone $5),$6,$7,$8,$9,$10) returning id`,
    [userId, type, date, time || '12:00', tz, title, notes, JSON.stringify(tags), JSON.stringify(meta), source || null]
  );
  return r.rows[0].id;
}

/** Update title/notes/meta and optionally the moment (date+time or occurredAt). */
export async function updateEvent(db, userId, id, { occurredAt, date, time, tz = DEFAULT_TZ, title, notes, meta, type }) {
  const sets = []; const vals = [userId, id];
  if (occurredAt) { vals.push(occurredAt); sets.push(`occurred_at = $${vals.length}`); }
  else if (date) { vals.push(date, time || '12:00', tz); sets.push(`occurred_at = (($${vals.length - 2}::date || ' ' || $${vals.length - 1})::timestamp at time zone $${vals.length})`); }
  if (title !== undefined) { vals.push(title); sets.push(`title = $${vals.length}`); }
  if (notes !== undefined) { vals.push(notes); sets.push(`notes = $${vals.length}`); }
  if (meta !== undefined) {
    vals.push(JSON.stringify(meta)); sets.push(`meta = $${vals.length}`);
    if (type) { vals.push(JSON.stringify((TAGS[type] || (() => []))(meta))); sets.push(`tags = $${vals.length}`); }
  }
  if (!sets.length) return;
  invalidateProfileCache();
  await db.query(`update events set ${sets.join(', ')} where user_id = $1 and id = $2`, vals);
}

export async function deleteEvent(db, userId, id) {
  if (!id) return;
  invalidateProfileCache();
  await db.query('delete from events where user_id = $1 and id = $2', [userId, id]);
}

/** Read meta with a fallback to the positional tags written before migration 019. */
export function eventMeta(row) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const tags = Array.isArray(row.tags) ? row.tags : [];
  if (row.type === 'MED_ADMIN') return { status: meta.status || (tags[1] || '').toUpperCase() || null };
  if (row.type === 'MILESTONE') return { kind: meta.kind || tags[1] || 'other', tone: meta.tone || tags[2] || 'neutral' };
  if (row.type === 'INFUSION') return { agent: meta.agent || tags[1] || null };
  return meta;
}
