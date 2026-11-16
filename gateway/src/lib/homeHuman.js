/**
 * The human side of the home screen (GET /home/human): good news (goodNews.js), quiet milestones and quiet mode.
 *
 * Quiet milestones: «100 дней терапии», «Год с начала терапии», «100 дней приёма подряд». Shown for a few days after
 * they are reached, as codes and numbers: the frontend words them from the dictionary.
 * Quiet mode: streaks and milestones are not what a person wants to see after bad news, so a milestone marked
 * negative hides them for QUIET_DAYS unless the user brings them back; the patient card can switch them off for good.
 * The dose table itself stays: it is data, not a celebration.
 */
import { pool } from './db.js';
import { addDays, todayKey, DEFAULT_TZ } from './dates.js';
import { getSetting, setSetting } from './settings.js';
import { streakFor } from './medsStreak.js';
import { patientCard } from './patientCard.js';
import { goodNews } from './goodNews.js';

export const QUIET_DAYS = 14;
export const MOMENT_DAYS = 3; // a milestone stays on the screen this many days after the day it was reached
const THERAPY_MARKS = [100, 200, 300];
const STREAK_MARKS = [30, 100, 200, 365];

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** Quiet milestones reached in the last MOMENT_DAYS days: [{ id, kind: 'therapyDays' | 'therapyYears' | 'streakDays' | 'streakDoses', n, date }]. */
export function momentsFrom({ regimenStart, currentStreak = 0, daily = true, today }) {
  const out = [];
  const fresh = (date) => { const d = daysBetween(date, today); return d >= 0 && d <= MOMENT_DAYS; };
  if (regimenStart && regimenStart <= today) {
    for (const n of THERAPY_MARKS) {
      const date = addDays(regimenStart, n - 1);
      if (fresh(date)) out.push({ id: `therapy:${regimenStart}:${n}`, kind: 'therapyDays', n, date });
    }
    const [y, m, d] = regimenStart.split('-').map(Number);
    for (let n = 1; n <= Number(today.slice(0, 4)) - y; n++) {
      const date = `${y + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (fresh(date)) out.push({ id: `therapy:${regimenStart}:y${n}`, kind: 'therapyYears', n, date });
    }
  }
  const marks = [...STREAK_MARKS];
  while (marks[marks.length - 1] < currentStreak) marks.push(marks[marks.length - 1] + 365);
  for (const n of marks) {
    if (currentStreak >= n && currentStreak - n <= MOMENT_DAYS) {
      const date = addDays(today, n - currentStreak);
      out.push({ id: `streak:${date}:${n}`, kind: daily ? 'streakDays' : 'streakDoses', n, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** { on, reason: 'setting' | 'badNews' | null, milestoneId }. badNews: { id, date } is the latest negative milestone. */
export function quietFrom({ enabled, badNews, resumedId, today, days = QUIET_DAYS }) {
  if (!enabled) return { on: true, reason: 'setting', milestoneId: null };
  if (badNews && badNews.id !== resumedId && badNews.date <= today && daysBetween(badNews.date, today) <= days) return { on: true, reason: 'badNews', milestoneId: badNews.id };
  return { on: false, reason: null, milestoneId: null };
}

async function latestBadNews(userId, today) {
  const r = await pool.query(
    `select id, date::text as date from milestones where user_id = $1 and tone = 'negative' and kind <> 'ai_review' and date >= $2::date and date <= $3::date order by date desc, created_at desc limit 1`,
    [userId, addDays(today, -QUIET_DAYS), today],
  );
  return r.rows[0] || null;
}

/** { goodNews, moments, quiet } for the home screen. */
export async function homeHuman(userId, tz = DEFAULT_TZ) {
  const today = todayKey(tz);
  const [news, badNews, streak] = await Promise.all([goodNews(userId, tz), latestBadNews(userId, today), streakFor(userId, { days: 7, tz })]);
  const quiet = quietFrom({ enabled: patientCard().moments, badNews, resumedId: getSetting('home_quiet_resumed'), today });
  const moments = quiet.on ? [] : momentsFrom({ regimenStart: streak.regimenStart, currentStreak: streak.currentStreak, daily: !streak.schedule || streak.schedule.frequencyRule === 'DAILY', today });
  return { goodNews: news, moments, quiet };
}

/** «Вернуть»: bring streaks and milestones back after this bad news; the next one turns quiet mode on again. */
export async function resumeFromQuiet(userId, tz = DEFAULT_TZ) {
  const bad = await latestBadNews(userId, todayKey(tz));
  if (bad) await setSetting('home_quiet_resumed', bad.id);
  return homeHuman(userId, tz);
}
