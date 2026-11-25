/**
 * One status per day from the dose marks («2 раза в день» gives two marks a day). The rule, the same for the streak,
 * the calendar, the doctor report and the AI profile:
 *   all doses of the day taken → TAKEN; some taken → PARTIAL; otherwise PAUSED, then SKIPPED, then whatever is there.
 * The expected dose count is captured with the administration for historical reports.
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

/** Day statuses for one medication, or a combined count including all scheduled systemic medications on each recorded day. */
export async function dayStatuses(userId, { medicationId = null, from, to }) {
  const { pool } = await import('./db.js');
  const r = await pool.query(
    `with recorded as (
       select a.day, a.medication_id,
              count(*) filter (where a.status = 'TAKEN')::int as taken,
              max(a.expected_doses) as times,
              bool_or(a.status = 'PAUSED') as paused,
              bool_or(a.status = 'SKIPPED') as skipped,
              min(a.status::text) as other
       from administrations a join medications m on m.id = a.medication_id
       where a.user_id = $1 and a.day between $2::date and $3::date
         and ${medicationId ? 'a.medication_id = $4' : "m.role = 'systemic'"}
       group by a.day, a.medication_id
     ), per_medication as (
       select * from recorded
       ${medicationId ? '' : `union all
         select d.day, ri.medication_id, 0, max(ri.times_per_day), false, false, null
         from (select distinct day from recorded) d
         join regimens r on r.user_id = $1 and r.start_date <= d.day and (r.end_date is null or d.day < r.end_date)
         join regimen_items ri on ri.regimen_id = r.id and not coalesce(ri.prn, false)
         join medications m on m.id = ri.medication_id and m.role = 'systemic'
         where not exists (select 1 from recorded a where a.medication_id = ri.medication_id and a.day = d.day)
           and case ri.frequency_rule
               when 'WEEKLY' then extract(isodow from d.day)::int = any(
                 case when cardinality(ri.schedule_days) > 0 then ri.schedule_days
                      else array[extract(isodow from r.start_date)::smallint] end)
               when 'EVERY_N_DAYS' then (d.day - r.start_date) % greatest(1, coalesce(ri.interval_days, 1)) = 0
               else true end
         group by d.day, ri.medication_id`}
     )
     select day::text as day, sum(taken)::int as taken, sum(times)::int as times,
            case when bool_and(taken >= times) then 'TAKEN'
                 when sum(taken) > 0 then 'PARTIAL'
                 when bool_or(paused) then 'PAUSED'
                 when bool_or(skipped) then 'SKIPPED'
                 else min(other) end as status
     from per_medication group by day order by day`,
    medicationId ? [userId, from, to, medicationId] : [userId, from, to]
  );
  return r.rows;
}
