/**
 * Dates, times and numbers by the user's language and regional settings (docs/I18N.md).
 * Shared by the frontend and the gateway: plain ESM without dependencies, types in format.d.ts.
 *
 * Language picks the words (month and weekday names); region picks the formats (numeric date order, 12/24 hours,
 * decimal separator, first day of the week). Every regional default can be overridden in the settings.
 */

import { displayUnit } from './units.js';

export const LANGUAGES = ['ru', 'en'];
export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'ymd'];
export const HOUR_CYCLES = ['auto', 'h23', 'h12'];
export const WEEK_STARTS = ['auto', 'mon', 'sun'];
export const LAB_UNIT_PREFS = ['auto', 'si', 'conventional'];
export const TEMPERATURE_PREFS = ['auto', 'c', 'f'];
export const WEIGHT_PREFS = ['auto', 'kg', 'lb'];
// Regions where the defaults are not SI (CLDR measurement systems): US units in the lab, °F, pounds.
const US_LABS = new Set(['US']);
const FAHRENHEIT = new Set(['US', 'BS', 'BZ', 'KY', 'PW', 'LR', 'FM', 'MH']);
const POUNDS = new Set(['US', 'LR', 'MM']);
// Regions offered in the settings (ISO 3166 codes); names come from Intl.DisplayNames in the interface language.
export const REGIONS = [
  'RU', 'BY', 'KZ', 'UZ', 'KG', 'TJ', 'AM', 'GE', 'AZ', 'UA', 'MD', 'IL', 'TR', 'CY', 'RS', 'ME',
  'DE', 'AT', 'CH', 'FR', 'BE', 'NL', 'LU', 'ES', 'PT', 'IT', 'GR', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'SI', 'HR',
  'FI', 'SE', 'NO', 'DK', 'EE', 'LV', 'LT', 'GB', 'IE', 'US', 'CA', 'MX', 'BR', 'AR', 'AU', 'NZ',
  'AE', 'TH', 'VN', 'ID', 'IN', 'CN', 'JP', 'KR',
];
export const DEFAULT_LANGUAGE = 'ru';
export const DEFAULT_PREFS = Object.freeze({ region: 'RU', dateFormat: 'auto', hourCycle: 'auto', weekStart: 'auto', labUnits: 'auto', temperature: 'auto', weight: 'auto' });

const DAY_KEY_RX = /^\d{4}-\d{2}-\d{2}$/;
// Where Intl.Locale has no week info (older engines): CLDR regions whose week starts on Sunday.
const SUNDAY_FIRST = new Set(['US', 'CA', 'MX', 'BR', 'AR', 'JP', 'KR', 'CN', 'IL', 'IN', 'PH', 'TH', 'ID', 'HK', 'TW', 'ZA', 'PE', 'CO', 'VE', 'SA']);

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Settings object with every field valid; unknown fields are dropped, invalid values fall back to the defaults. */
export function normalizePrefs(p) {
  const x = p && typeof p === 'object' ? p : {};
  const region = typeof x.region === 'string' ? x.region.toUpperCase() : '';
  return {
    region: REGIONS.includes(region) ? region : DEFAULT_PREFS.region,
    dateFormat: pick(x.dateFormat, DATE_FORMATS, DEFAULT_PREFS.dateFormat),
    hourCycle: pick(x.hourCycle, HOUR_CYCLES, DEFAULT_PREFS.hourCycle),
    weekStart: pick(x.weekStart, WEEK_STARTS, DEFAULT_PREFS.weekStart),
    labUnits: pick(x.labUnits, LAB_UNIT_PREFS, DEFAULT_PREFS.labUnits),
    temperature: pick(x.temperature, TEMPERATURE_PREFS, DEFAULT_PREFS.temperature),
    weight: pick(x.weight, WEIGHT_PREFS, DEFAULT_PREFS.weight),
  };
}

export const normalizeLanguage = (l) => pick(l, LANGUAGES, DEFAULT_LANGUAGE);

/** The likely locale of a region: 'US' → 'en-US', 'RU' → 'ru-RU'. */
export function regionLocale(region) {
  try {
    const l = new Intl.Locale('und', { region }).maximize();
    return `${l.language}-${l.region}`;
  } catch {
    return 'ru-RU';
  }
}

/** A guess for the first run: the region of the browser language ('en-GB' → 'GB'), else the default. */
export function guessRegion(browserLocale) {
  try {
    const r = new Intl.Locale(browserLocale).maximize().region;
    return REGIONS.includes(r) ? r : DEFAULT_PREFS.region;
  } catch {
    return DEFAULT_PREFS.region;
  }
}

function regionHourCycle(locale) {
  try {
    const hc = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hc === 'h11' || hc === 'h12' ? 'h12' : 'h23';
  } catch {
    return 'h23';
  }
}

function regionWeekStart(locale, region) {
  try {
    const l = new Intl.Locale(locale);
    const info = typeof l.getWeekInfo === 'function' ? l.getWeekInfo() : l.weekInfo;
    if (info?.firstDay) return info.firstDay === 7 ? 7 : 1;
  } catch { /* fall through */ }
  return SUNDAY_FIRST.has(region) ? 7 : 1;
}

/**
 * Formatter for one user: { language, region, locale, timeZone, hourCycle, weekStart, date, time, number, weekdays, months }.
 * date(value, options?) takes an instant (Date, ISO string, ms) or a calendar day 'YYYY-MM-DD' (shown as is, no time zone
 * shift); without options it is the numeric date of the region or of the chosen format, with Intl options it is words
 * in the interface language. timeZone omitted: the runtime's own zone.
 */
export function createFormat({ language, prefs, timeZone } = {}) {
  const lang = normalizeLanguage(language);
  const p = normalizePrefs(prefs);
  const locale = regionLocale(p.region);
  const hourCycle = p.hourCycle === 'auto' ? regionHourCycle(locale) : p.hourCycle;
  const weekStart = p.weekStart === 'mon' ? 1 : p.weekStart === 'sun' ? 7 : regionWeekStart(locale, p.region);
  const tz = timeZone || undefined;
  // units: 'auto' follows the region
  const labUnits = p.labUnits === 'auto' ? (US_LABS.has(p.region) ? 'conventional' : 'si') : p.labUnits;
  const temperature = p.temperature === 'auto' ? (FAHRENHEIT.has(p.region) ? 'f' : 'c') : p.temperature;
  const weight = p.weight === 'auto' ? (POUNDS.has(p.region) ? 'lb' : 'kg') : p.weight;

  const cache = new Map();
  const dtf = (loc, opts) => {
    const key = `${loc}|${JSON.stringify(opts)}`;
    let f = cache.get(key);
    if (!f) { f = new Intl.DateTimeFormat(loc, opts); cache.set(key, f); }
    return f;
  };
  // A calendar day is pinned to noon UTC and shown in UTC, so it never moves to the neighbouring day.
  const instant = (v) => {
    if (typeof v === 'string' && DAY_KEY_RX.test(v)) return { d: new Date(`${v}T12:00:00Z`), zone: 'UTC' };
    return { d: v instanceof Date ? v : new Date(v), zone: tz };
  };
  // Russian dates read better without the trailing «г.» Intl adds after the year («3 ноября 2026»).
  const tidy = (s) => (lang === 'ru' ? s.replace(/\s*г\.$/, '').replace(/\s*г\.,/, ',') : s);

  function numericDate(d, zone) {
    if (p.dateFormat === 'auto') return dtf(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(d);
    const parts = Object.fromEntries(dtf('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).formatToParts(d).map((x) => [x.type, x.value]));
    if (p.dateFormat === 'mdy') return `${parts.month}/${parts.day}/${parts.year}`;
    if (p.dateFormat === 'ymd') return `${parts.year}-${parts.month}-${parts.day}`;
    return `${parts.day}.${parts.month}.${parts.year}`;
  }

  function date(value, options) {
    if (value == null || value === '') return '';
    const { d, zone } = instant(value);
    if (Number.isNaN(d.getTime())) return '';
    if (!options) return numericDate(d, zone);
    const opts = { ...options, timeZone: options.timeZone || zone };
    if (opts.hour !== undefined) {
      opts.hourCycle = hourCycle;
      if (hourCycle === 'h12' && opts.hour === '2-digit') opts.hour = 'numeric'; // «9:05 PM», not «09:05 PM»
    }
    return tidy(dtf(lang, opts).format(d));
  }

  const time = (value) => date(value, { hour: '2-digit', minute: '2-digit' });

  /** Hour of the day 0–23 on the user's clock (time zone), whatever the 12/24-hour display: for «доброе утро». */
  function hour(value = new Date()) {
    const { d, zone } = instant(value);
    if (Number.isNaN(d.getTime())) return null;
    return Number(dtf('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(d)) % 24;
  }

  /** A wall-clock time stored as text ('14:30', appointment or infusion time) on the user's clock; other text as is. */
  function clock(hhmm) {
    const m = /^(\d{1,2}):(\d{2})(:\d{2})?$/.exec(String(hhmm ?? '').trim());
    if (!m) return hhmm == null ? '' : String(hhmm);
    return date(new Date(Date.UTC(2024, 0, 1, Number(m[1]), Number(m[2]))), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }

  const nfCache = new Map();
  function number(n, options = {}) {
    if (n == null || n === '' || Number.isNaN(Number(n))) return '';
    const key = JSON.stringify(options);
    let f = nfCache.get(key);
    if (!f) { f = new Intl.NumberFormat(locale, options); nfCache.set(key, f); }
    return f.format(Number(n));
  }

  /** Decimal separator of the region ('ru-RU' «,», 'en-US' «.»). */
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((x) => x.type === 'decimal')?.value || ',';

  /** A number typed as text in a lab report («5.9», «<0.1») with the region's decimal separator; other text as is. */
  function numText(s) {
    if (s == null) return null;
    const t = String(s).trim();
    return /^[<>≤≥]?\s*[+-]?\d+([.,]\d+)?$/.test(t) ? t.replace(/[.,]/, decimal) : t;
  }

  /** [[isoDay 1..7, name]] starting from the first day of the week; width 'short' («пн») or 'long'. */
  function weekdays(width = 'short') {
    const f = dtf(lang, { weekday: width, timeZone: 'UTC' });
    const days = [];
    for (let i = 0; i < 7; i++) {
      const iso = ((weekStart - 1 + i) % 7) + 1;
      days.push([iso, f.format(new Date(Date.UTC(2024, 0, iso)))]); // 1 Jan 2024 was a Monday
    }
    return days;
  }

  /** Twelve month names, standalone form ('long' «ноябрь», 'short' «нояб.»). */
  function months(width = 'long') {
    const f = dtf(lang, { month: width, timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, m) => f.format(new Date(Date.UTC(2024, m, 15))));
  }

  return { language: lang, region: p.region, locale, timeZone: tz, hourCycle, weekStart, labUnits, temperature, weight, decimal, prefs: p, date, time, hour, clock, number, numText, weekdays, months, unit: (u) => displayUnit(u, lang) };
}
