/**
 * Minute ticker for reminders. Idempotent through the notifications table.
 * - dose: at the dose time (Settings → Telegram or REMIND_DOSE_AT, default 11:00) if today's dose is not recorded;
 *   again at the repeat time (REMIND_DOSE_AGAIN_AT, 20:00; none when cleared); in the user's time zone
 * - alert: every open alert once, within a minute of being raised
 * - labs_stale: Monday 10:00 if the newest lab result is older than LAB_STALE_DAYS (28)
 */
import { dayKey, addDays, DEFAULT_TZ } from './dates.js';
import { telegramReady, sendTelegram, telegramConfig, keyboard } from './telegram.js';
import { esc, fmtDateLong } from './telegramText.js';
import { upcoming } from './appointments.js';
import { dueCourses } from './infusions.js';
import { backupStatus, backupLine } from './backupStatus.js';
import { available } from './edition.js';
import { getProtocol, protocolIn } from './protocol.js';
import { isDoseDay } from './schedule.js';
import { reminderTimes } from './reminderTimes.js';
import { userFormat } from './userLocale.js';
import { alertMessage } from './alerts.js';
import { doseUnit } from './eventText.js';
import { t } from './i18n.js';

function hm(now, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { time: `${get('hour').padStart(2, '0')}:${get('minute')}`, weekday: get('weekday') };
}
function within(now, target, hours = 3) {
  const [h, m] = target.split(':').map(Number);
  const [nh, nm] = now.split(':').map(Number);
  const diff = (nh * 60 + nm) - (h * 60 + m);
  return diff >= 0 && diff <= hours * 60;
}

export function startScheduler({ pool, userId, log = console, intervalMs = 60_000, now: nowFn = () => new Date(), sendImpl = sendTelegram, readyImpl = telegramReady }) {
  // read every tick: times and the time zone change in Settings without a restart
  let tz = DEFAULT_TZ;
  let cfg = reminderTimes();

  async function alreadySent(kind, ref) {
    const r = await pool.query('select 1 from notifications where user_id=$1 and kind=$2 and ref=$3', [userId, kind, ref]);
    return r.rows.length > 0;
  }
  // Claim the (kind, ref) row first so a crash or a concurrent tick cannot send twice; roll the claim back if sending fails.
  // Text is escaped for Telegram HTML mode (a «<» in instructions used to break every send).
  // A failing send does not stop the rest of the tick; the first error is rethrown at the end.
  let tickErrors = [];
  async function send(kind, ref, text, extra) {
    text = esc(text);
    const ins = await pool.query('insert into notifications (user_id, kind, ref, text) values ($1,$2,$3,$4) on conflict do nothing returning id', [userId, kind, ref, text]);
    if (!ins.rows.length) return false;
    try {
      await sendImpl(text, undefined, extra);
    } catch (e) {
      await pool.query('delete from notifications where id = $1', [ins.rows[0].id]).catch(() => {});
      log.warn({ kind, ref, err: e.message }, 'telegram send failed');
      tickErrors.push(e);
      return false;
    }
    log.info({ kind, ref }, 'telegram sent');
    return true;
  }

  async function tick() {
    tickErrors = [];
    try { await tickInner(); } finally { if (tickErrors.length) { const e = tickErrors[0]; tickErrors = []; throw e; } }
  }
  async function tickInner() {
    if (!readyImpl()) return;
    const { appUrl } = telegramConfig();
    const now = nowFn();
    cfg = reminderTimes();
    const f = await userFormat(userId); // the user's zone and language, not the server's default
    const language = f.language;
    const say = (key, args) => t(language, `bot.remind.${key}`, args);
    tz = f.timeZone;
    const { time, weekday } = hm(now, tz);
    const today = dayKey(now, tz);

    // Dose reminders: the systemic drug at REMIND_DOSE_AT with a repeat at REMIND_DOSE_AGAIN_AT;
    // supporting medications at their own remind_at (no repeat). One reminder per medication per day.
    const { activeItems } = await import('./medsRecord.js');
    const items = await activeItems(userId);
    // marks so far today per medication: with «2 раза в день» the repeat still comes while a dose is unmarked
    const todayRows = (await pool.query(`select medication_id, count(*)::int as n, bool_or(status = 'PAUSED') as paused from administrations where user_id=$1 and day = $2::date group by medication_id`, [userId, today])).rows;
    const marked = new Map(todayRows.map((x) => [x.medication_id, x.n]));
    const paused = new Set(todayRows.filter((x) => x.paused).map((x) => x.medication_id));
    for (const it of items) {
      const done = marked.get(it.medicationId) || 0;
      const times = Math.max(1, Number(it.timesPerDay) || 1);
      if (done >= times || paused.has(it.medicationId)) continue; // all doses marked, or a therapy pause today
      if (!isDoseDay(it, today)) continue; // weekly or every-N-days schedules: no reminder on other days
      const slots = it.role === 'systemic' ? [['dose', cfg.doseAt], ...(cfg.doseAgainAt ? [['dose_again', cfg.doseAgainAt]] : [])] : (it.remindAt ? [[`dose:${it.medicationId}`, it.remindAt]] : []);
      for (const [kind, at] of slots) {
        if (!within(time, at)) continue;
        if (kind === 'dose' && done > 0) continue; // the first reminder is only for a day with nothing marked yet
        const dose = it.doseValue ? ` ${it.doseValue} ${doseUnit(it.doseUnit, language)}` : '';
        const how = it.instructions ? `\n${it.instructions}` : '';
        const url = `${appUrl}/meds`;
        const text = kind === 'dose_again'
          ? (done > 0 ? say('doseCounted', { name: it.name, dose, done, times, url }) : say('doseAgain', { name: it.name, dose, url }))
          : say('dose', { name: it.name, dose, how, url });
        const suffix = it.role === 'systemic' ? '' : `:${it.medicationId}`;
        await send(kind, today, text, keyboard([[{ text: say('taken'), data: `dose:TAKEN:${today}${suffix}` }, { text: say('skip'), data: `dose:SKIPPED:${today}${suffix}` }]]));
      }
    }

    // New alerts
    const alerts = await pool.query(
      `select a.id, a.context from alerts a
       where a.user_id = $1 and a.status = 'OPEN' and a.created_at > now() - interval '2 days' and a.triggered_at > now() - interval '3 days'
         and not exists (select 1 from notifications n where n.user_id = a.user_id and n.kind = 'alert' and n.ref = a.id::text)
       order by a.created_at`,
      [userId]
    );
    for (const a of alerts.rows) {
      const c = a.context || {};
      const icon = c.severity === 'RED' ? '🔴' : '🟡';
      await send('alert', a.id, `${icon} ${alertMessage(c, f)}\n${appUrl}${c.href || '/alerts'}`);
    }

    // Doctor appointments: 7 days before (10:00), the evening before (18:00), the morning of (08:00);
    // after the date without a report: 19:00 next day, then every third day.
    const ap = await upcoming(userId, tz);
    const label = (a) => say('appointment', { doctor: a.doctor || say('doctor'), date: fmtDateLong(a.date, f), time: a.time ? say('at', { time: f.clock(a.time) }) : '', place: a.place ? `, ${a.place}` : '' });
    const consults = `${appUrl}/consults`;
    for (const a of ap.planned || (ap.next ? [ap.next] : [])) {
      const daysLeft = Math.round((new Date(`${a.date}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
      if (daysLeft === 7 && within(time, '10:00')) await send('appt_7d', a.id, say('apptWeek', { label: label(a), url: consults }));
      if (daysLeft === 1 && within(time, '18:00')) await send('appt_1d', a.id, say('apptTomorrow', { label: label(a), questions: say(a.questions ? 'questionsReady' : 'questionsMissing'), url: consults }));
      if (daysLeft === 0 && within(time, '08:00')) await send('appt_0d', a.id, say('apptToday', { label: label(a), url: consults }));
    }
    for (const a of ap.overdue) {
      const daysAfter = Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${a.date}T12:00:00Z`)) / 86400000);
      if (daysAfter >= 1 && (daysAfter - 1) % 3 === 0 && within(time, '19:00')) {
        await send('appt_report', `${a.id}:${today}`, say('apptReport', { label: label(a), url: consults }),
          keyboard([[{ text: say('apptNoReport'), data: `appt:done:${a.id}` }]]));
      }
    }

    // Infusion courses: on the due day at 10:00, then every third day while the session is not recorded
    if (within(time, '10:00')) {
      for (const c of await dueCourses(userId, today)) {
        const late = Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${c.nextDue}T12:00:00Z`)) / 86400000);
        if (late % 3 !== 0) continue;
        const name = c.title || c.agentShort || c.agentName;
        await send('course_due', `${c.id}:${today}`, say('course', { name, done: c.done, of: c.plannedCount ? say('courseOf', { n: c.plannedCount }) : '', when: late === 0 ? t(language, 'bot.dose.today') : say('courseWas', { date: fmtDateLong(c.nextDue, f) }), url: `${appUrl}/infusions` }));
      }
    }

    // Backups: morning line at 08:30, alert at 09:30 if something failed or the last backup is stale.
    // The desktop edition has no backup service, so nothing to report there.
    if (available('backups') && within(time, '08:30', 1)) {
      const b = await backupStatus(language);
      if (b) await send('backup_daily', today, backupLine(b, f));
    }
    if (available('backups') && within(time, '09:30', 1)) {
      const b = await backupStatus(language);
      if (!b || !b.ok) await send('backup_fail', today, say('backupFail', { problems: b ? b.problems.join(', ') : say('backupNoStatus'), url: `${appUrl}/settings` }));
    }

    // Stale labs, Mondays
    if (weekday === 'Mon' && within(time, '10:00')) {
      const last = await pool.query('select max(collected_at) as last from lab_results where user_id = $1', [userId]);
      const lastAt = last.rows[0]?.last ? new Date(last.rows[0].last) : null;
      const days = lastAt ? Math.floor((now - lastAt) / 86400000) : null;
      if (days == null || days >= cfg.labStaleDays) {
        await send('labs_stale', today, say('labsStale', { when: days == null ? say('labsLongAgo') : say('labsDaysAgo', { days }), hint: protocolIn(getProtocol(), language).labCadenceHint || say('labsAskDoctor'), url: `${appUrl}/labs/upload` }));
      }
    }
  }

  let running = false;
  const guarded = () => { if (running) return; running = true; tick().catch((e) => log.error({ err: e }, 'scheduler tick failed')).finally(() => { running = false; }); };
  const timer = setInterval(guarded, intervalMs);
  timer.unref?.();
  setTimeout(guarded, 5000).unref?.();
  log.info(`scheduler: telegram ${telegramReady() ? 'on' : 'off (no token/chat)'}, dose ${cfg.doseAt} / ${cfg.doseAgainAt || 'no repeat'}, labs stale ${cfg.labStaleDays}d`);
  const stop = () => clearInterval(timer);
  stop.tick = tick;
  return stop;
}
