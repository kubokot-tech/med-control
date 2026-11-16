/** Calendar-day helpers. A "day" is always computed in the user's IANA timezone, never UTC. */

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    // en-US + formatToParts: works with small-icu builds too (sv-SE is not guaranteed to exist).
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

export const DEFAULT_TZ = 'Europe/Moscow';

export function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 'YYYY-MM-DD' of `date` in timezone `tz`. */
export function dayKey(date, tz = DEFAULT_TZ) {
  const parts = fmt(tz).formatToParts(date instanceof Date ? date : new Date(date));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayKey(tz = DEFAULT_TZ) {
  return dayKey(new Date(), tz);
}

/** Add n calendar days to a 'YYYY-MM-DD' key (noon UTC anchor avoids DST edge cases). */
/** 12:00 of `day` ('YYYY-MM-DD') in `tz`, as an ISO timestamp: a mark made for a past day from the bot or the calendar. */
export function noonIn(day, tz = DEFAULT_TZ) {
  const guess = new Date(`${day}T12:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(guess).map((x) => [x.type, x.value]));
  const shownAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess.getTime() - (shownAsUtc - guess.getTime())).toISOString();
}

export function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** A calendar day for an Excel cell: Excel keeps no time zone, so the day must be midnight UTC, whatever TZ the server has. */
export const excelDay = (day) => new Date(`${day}T00:00:00Z`);
