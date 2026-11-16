import { t } from './i18n.js';

/**
 * Dosing schedules: which calendar days are dose days. Pure module (no database).
 * item: { frequencyRule: 'DAILY' | 'WEEKLY' | 'EVERY_N_DAYS', scheduleDays?: number[] (ISO 1–7), intervalDays?: number, startDate: 'YYYY-MM-DD' }
 */
export const RULES = ['DAILY', 'WEEKLY', 'EVERY_N_DAYS'];

const toDate = (day) => new Date(`${day}T12:00:00Z`);
/** ISO weekday of a 'YYYY-MM-DD' day: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day) { return toDate(day).getUTCDay() || 7; }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function addDay(day, n) { const d = toDate(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** Fill defaults: WEEKLY without days falls back to the start date's weekday, EVERY_N_DAYS needs n ≥ 2. */
export function normalizeSchedule(item) {
  const rule = RULES.includes(item.frequencyRule) ? item.frequencyRule : 'DAILY';
  if (rule === 'WEEKLY') {
    const days = [...new Set((item.scheduleDays || []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    return { frequencyRule: rule, scheduleDays: days.length ? days : [isoWeekday(item.startDate)], intervalDays: null };
  }
  if (rule === 'EVERY_N_DAYS') {
    const n = Math.round(Number(item.intervalDays));
    return Number.isFinite(n) && n >= 2 ? { frequencyRule: rule, scheduleDays: null, intervalDays: n } : { frequencyRule: 'DAILY', scheduleDays: null, intervalDays: null };
  }
  return { frequencyRule: 'DAILY', scheduleDays: null, intervalDays: null };
}

/** Is `day` a dose day for this item? Days before the start never are. */
export function isDoseDay(item, day) {
  if (item.startDate && day < item.startDate) return false;
  const s = normalizeSchedule(item);
  if (s.frequencyRule === 'WEEKLY') return s.scheduleDays.includes(isoWeekday(day));
  if (s.frequencyRule === 'EVERY_N_DAYS') return daysBetween(item.startDate, day) % s.intervalDays === 0;
  return true;
}

/** The first dose day on or after `day` (within a year), or null. */
export function nextDoseDay(item, day) {
  for (let i = 0; i < 366; i++) { const d = addDay(day, i); if (isDoseDay(item, d)) return d; }
  return null;
}

/** «ежедневно», «2 раза в день», «по понедельникам», «по пн и чт, 2 раза в день», «раз в 3 дня»; in `language`. */
export function describeSchedule(item, language) {
  const s = normalizeSchedule(item);
  const times = Math.max(1, Math.round(Number(item?.timesPerDay ?? item?.times_per_day ?? 1)) || 1);
  const perDay = t(language, 'schedule.timesPerDay', { n: times });
  const withTimes = (schedule) => (times > 1 ? t(language, 'schedule.withTimes', { schedule, times: perDay }) : schedule);
  if (s.frequencyRule === 'WEEKLY') {
    if (s.scheduleDays.length === 1) return withTimes(t(language, `schedule.onDay.${s.scheduleDays[0]}`));
    const days = new Intl.ListFormat(language || 'ru', { type: 'conjunction' }).format(s.scheduleDays.map((d) => t(language, `schedule.dayShort.${d}`)));
    return withTimes(t(language, 'schedule.onDays', { days }));
  }
  if (s.frequencyRule === 'EVERY_N_DAYS') return withTimes(t(language, 'schedule.everyNDays', { n: s.intervalDays }));
  return times > 1 ? perDay : t(language, 'schedule.daily');
}

/** Row → schedule fields (columns frequency_rule, schedule_days, interval_days, start_date). */
export function scheduleFromRow(row) {
  const s = normalizeSchedule({ frequencyRule: row.frequency_rule, scheduleDays: row.schedule_days, intervalDays: row.interval_days, startDate: String(row.start_date || '').slice(0, 10) });
  return row.times_per_day != null ? { ...s, timesPerDay: Number(row.times_per_day) || 1 } : s;
}
