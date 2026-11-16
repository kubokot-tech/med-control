/** Dosing schedules on the client (mirror of gateway/src/lib/schedule.js): which days are dose days. */
export type Schedule = { frequencyRule?: string | null; scheduleDays?: number[] | null; intervalDays?: number | null };

const toDate = (day: string) => new Date(`${day}T12:00:00Z`);
export const isoWeekday = (day: string) => toDate(day).getUTCDay() || 7;

export function isDoseDay(s: Schedule | null | undefined, day: string, startDate?: string | null): boolean {
  if (startDate && day < startDate) return false;
  if (!s || !s.frequencyRule || s.frequencyRule === 'DAILY') return true;
  if (s.frequencyRule === 'WEEKLY') {
    const days = s.scheduleDays?.length ? s.scheduleDays : startDate ? [isoWeekday(startDate)] : [];
    return days.includes(isoWeekday(day));
  }
  if (s.frequencyRule === 'EVERY_N_DAYS' && s.intervalDays && startDate) {
    return Math.round((toDate(day).getTime() - toDate(startDate).getTime()) / 86400000) % s.intervalDays === 0;
  }
  return true;
}
