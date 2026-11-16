/**
 * Language and regional settings of the user (docs/I18N.md): users.locale, users.prefs and the time zone.
 * The formatter itself is shared with the frontend (shared/format.js).
 */
import { pool } from './db.js';
import { DEFAULT_TZ, isValidTz } from './dates.js';
import { createFormat, normalizePrefs, normalizeLanguage, LANGUAGES, REGIONS, DATE_FORMATS, HOUR_CYCLES, WEEK_STARTS, LAB_UNIT_PREFS, TEMPERATURE_PREFS, WEIGHT_PREFS } from '../../../shared/format.js';
import { invalid } from './errors.js';

/** { language, prefs, timeZone } with every field valid. */
export async function getUserLocale(userId) {
  const r = await pool.query('select locale, prefs, timezone from users where id = $1', [userId]);
  const u = r.rows[0] || {};
  return { language: normalizeLanguage(u.locale), prefs: normalizePrefs(u.prefs), timeZone: isValidTz(u.timezone) ? u.timezone : DEFAULT_TZ };
}

/** Just the language: for answers that need the words and not the formats. */
export async function userLanguage(userId) {
  const r = await pool.query('select locale from users where id = $1', [userId]);
  return normalizeLanguage(r.rows[0]?.locale);
}

/** Save a partial change: { language?, timeZone?, prefs?: { region?, dateFormat?, hourCycle?, weekStart? } }. Unknown values are refused. */
export async function setUserLocale(userId, change) {
  const cur = await getUserLocale(userId);
  const p = change?.prefs || {};
  const bad = (p.region !== undefined && !REGIONS.includes(String(p.region).toUpperCase()))
    || (p.dateFormat !== undefined && !DATE_FORMATS.includes(p.dateFormat))
    || (p.hourCycle !== undefined && !HOUR_CYCLES.includes(p.hourCycle))
    || (p.weekStart !== undefined && !WEEK_STARTS.includes(p.weekStart))
    || (p.labUnits !== undefined && !LAB_UNIT_PREFS.includes(p.labUnits))
    || (p.temperature !== undefined && !TEMPERATURE_PREFS.includes(p.temperature))
    || (p.weight !== undefined && !WEIGHT_PREFS.includes(p.weight))
    || (change?.language !== undefined && !LANGUAGES.includes(change.language));
  if (bad) throw invalid('invalid_body');
  if (change?.timeZone !== undefined && !isValidTz(change.timeZone)) throw invalid('bad_timezone');
  const language = change?.language ?? cur.language;
  const prefs = normalizePrefs({ ...cur.prefs, ...p });
  const timeZone = change?.timeZone ?? cur.timeZone;
  await pool.query('update users set locale = $2, prefs = $3, timezone = $4 where id = $1', [userId, language, prefs, timeZone]);
  return { ...cur, language, prefs, timeZone };
}

/** Formatter for texts the gateway writes for this user (report, export, bot). */
export async function userFormat(userId) {
  return createFormat(await getUserLocale(userId));
}

/** What the settings screen can offer. */
export const localeOptions = () => ({ languages: LANGUAGES, regions: REGIONS, dateFormats: DATE_FORMATS, hourCycles: HOUR_CYCLES, weekStarts: WEEK_STARTS, labUnits: LAB_UNIT_PREFS, temperature: TEMPERATURE_PREFS, weight: WEIGHT_PREFS });
