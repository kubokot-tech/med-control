/**
 * One status per day from the dose marks («2 раза в день» gives two marks a day). The rule, the same for the streak,
 * the calendar, the doctor report and the AI profile:
 *   all doses of the day taken → TAKEN; some taken → PARTIAL; otherwise PAUSED, then SKIPPED, then whatever is there.
 * The number of doses is the regimen item's times_per_day at the time of reading (1 when the mark has no item).
 */
export const MAX_DOSES = 12;
export const dosesPerDay = (n) => Math.min(MAX_DOSES, Math.max(1, Math.round(Number(n) || 1)));

/** The same rule in code, for the marks of one day: [{ status }] and the number of doses. */
export function statusOfDay(marks, times) {
  const taken = marks.filter((m) => m.status === 'TAKEN').length;
  if (!marks.length) return null;
  if (taken >= dosesPerDay(times)) return 'TAKEN';
  if (taken > 0) return 'PARTIAL';
  if (marks.some((m) => m.status === 'PAUSED')) return 'PAUSED';
  if (marks.some((m) => m.status === 'SKIPPED')) return 'SKIPPED';
  return marks[0].status;
}

const DAY_SQL = `
  select a.day::text as day,
         count(*) filter (where a.status = 'TAKEN')::int as taken,
         greatest(1, least(${MAX_DOSES}, coalesce(max(ri.times_per_day), 1)))::int as times,
         case
           when count(*) filter (where a.status = 'TAKEN') >= greatest(1, coalesce(max(ri.times_per_day), 1)) then 'TAKEN'
           when count(*) filter (where a.status = 'TAKEN') > 0 then 'PARTIAL'
           when bool_or(a.status = 'PAUSED') then 'PAUSED'
           when bool_or(a.status = 'SKIPPED') then 'SKIPPED'
           else min(a.status::text)
         end as status
    from administrations a
    join medications m on m.id = a.medication_id
    left join regimen_items ri on ri.id = a.regimen_item_id`;

/**
 * Day statuses between `from` and `to` (inclusive, 'YYYY-MM-DD') for one medication, or for the systemic drug when
 * `medicationId` is not given. Returns [{ day, status, taken, times }] by day.
 */
export async function dayStatuses(userId, { medicationId = null, from, to }) {
  const { pool } = await import('./db.js'); // lazily: the pure helpers above are used where no database is loaded
  const r = await pool.query(
    `${DAY_SQL}
      where a.user_id = $1 and ${medicationId ? 'a.medication_id = $4' : "m.role = 'systemic'"} and a.day between $2::date and $3::date
      group by a.day order by a.day`,
    medicationId ? [userId, from, to, medicationId] : [userId, from, to]
  );
  return r.rows;
}
