/** Dose streak and calendar cells for one medication (the systemic drug by default). Days without a scheduled dose are OFF. */
import { pool } from './db.js';
import { DEFAULT_TZ, todayKey, addDays, dayRange } from './dates.js';
import { activeItems } from './medsRecord.js';
import { streakLength } from './streak.js';
import { scheduleFromRow, describeSchedule, isDoseDay } from './schedule.js';
import { dayStatuses } from './medsDays.js';

export async function streakFor(userId, { medicationId = null, days = 30, tz = DEFAULT_TZ, today: todayOverride = null } = {}) {
  const medId = medicationId || '';
  const today = todayOverride || todayKey(tz);
  const windowStart = addDays(today, -(days - 1));

  // without medication_id the streak is the systemic drug's (support meds are asked for explicitly)
  const sysMed = medId ? null : (await activeItems(userId)).find((x) => x.role === 'systemic')?.medicationId || null;
  const effMed = medId || sysMed;
  if (!effMed) return { streak: [], currentStreak: 0, totalTaken: 0, missed: 0, paused: 0, totalDays: 0, today: { date: todayKey(tz), status: null }, regimenStart: null, tz };
  const medFilter = effMed ? 'and ri.medication_id = $2' : '';
  const medParams = effMed ? [userId, effMed] : [userId];
  const reg = await pool.query(
    `select r.start_date::text as start_date, ri.frequency_rule, ri.schedule_days, ri.interval_days
     from regimens r
     join regimen_items ri on ri.regimen_id = r.id
     where r.user_id = $1 ${medFilter}
       and coalesce(ri.prn, false) = false
       and (r.end_date is null or r.end_date > now())
     order by r.start_date asc`,
    medParams
  );
  const regimenStart = reg.rows[0]?.start_date || null;
  // The newest regimen's schedule decides which days are dose days (older regimens of the same drug were daily).
  const sched = reg.rows.length ? { ...scheduleFromRow(reg.rows[reg.rows.length - 1]), startDate: reg.rows[reg.rows.length - 1].start_date } : null;

  // The display window is `days`, but the streak itself looks back a full year: a 7-day window must not cap it at 7.
  const historyStart = addDays(today, -364);
  // one status per day: with several doses a day, TAKEN only when all are taken (PARTIAL otherwise; lib/medsDays.js)
  const rows = await dayStatuses(userId, { medicationId: effMed, from: historyStart, to: today });
  const byDay = new Map(rows.map((row) => [row.day, row.status]));
  const todayRow = rows.find((row) => row.day === today);

  const dayStatus = (date) => {
    const recorded = byDay.get(date) ?? null;
    if (recorded) return { date, status: recorded };
    const onRegimen = regimenStart && date >= regimenStart;
    if (onRegimen && sched && sched.frequencyRule !== 'DAILY' && !isDoseDay({ ...sched, startDate: regimenStart }, date)) return { date, status: 'OFF' };
    return { date, status: onRegimen && date < today ? 'MISSED' : null };
  };
  const history = dayRange(historyStart, today).map(dayStatus);
  const streak = history.filter((s) => s.date >= windowStart);
  const currentStreak = streakLength(history);

  const totalTaken = streak.filter((s) => s.status === 'TAKEN').length;
  const partial = streak.filter((s) => s.status === 'PARTIAL' && s.date < today).length;
  const missed = streak.filter((s) => s.status === 'MISSED').length;
  const paused = streak.filter((s) => s.status === 'PAUSED').length;
  // Dose days in the window: days on the regimen with a scheduled dose (not OFF), minus pauses.
  const totalDays = (regimenStart ? streak.filter((s) => s.date >= regimenStart && s.status !== 'OFF').length : streak.length) - paused;

  return {
    streak,
    currentStreak,
    totalTaken,
    partial,
    missed,
    paused,
    totalDays,
    today: { date: today, status: byDay.get(today) ?? null, taken: todayRow?.taken ?? 0, times: todayRow?.times ?? null },
    regimenStart,
    schedule: sched ? { frequencyRule: sched.frequencyRule, text: describeSchedule({ ...sched, startDate: regimenStart }) } : null,
    tz,
  };
}
