// Types for format.js (the module is plain JavaScript so that the gateway runs it without a build step).
export type DateFormat = 'auto' | 'dmy' | 'mdy' | 'ymd';
export type HourCycle = 'auto' | 'h23' | 'h12';
export type WeekStart = 'auto' | 'mon' | 'sun';
export type LabUnitsPref = 'auto' | 'si' | 'conventional';
export type TemperaturePref = 'auto' | 'c' | 'f';
export type WeightPref = 'auto' | 'kg' | 'lb';
export interface RegionPrefs { region: string; dateFormat: DateFormat; hourCycle: HourCycle; weekStart: WeekStart; labUnits: LabUnitsPref; temperature: TemperaturePref; weight: WeightPref }
export type DateInput = Date | string | number | null | undefined;

export interface Format {
  language: string;
  region: string;
  /** Locale of the region, e.g. 'ru-RU', 'en-US': numbers and numeric dates. */
  locale: string;
  timeZone: string | undefined;
  hourCycle: 'h23' | 'h12';
  /** ISO weekday the week starts on: 1 Monday, 7 Sunday. */
  weekStart: 1 | 7;
  /** Units after «auto» is resolved by the region. */
  labUnits: 'si' | 'conventional';
  temperature: 'c' | 'f';
  weight: 'kg' | 'lb';
  /** Decimal separator of the region. */
  decimal: string;
  prefs: RegionPrefs;
  date(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  time(value: DateInput): string;
  /** Hour of the day 0–23 in the user's time zone (null for a bad date). */
  hour(value?: DateInput): number | null;
  /** A wall-clock time kept as text ('14:30') on the user's clock: '2:30 PM' with 12 hours. */
  clock(hhmm: string | null | undefined): string;
  number(n: number | string | null | undefined, options?: Intl.NumberFormatOptions): string;
  /** A number typed as text («5.9», «<0.1») with the region's decimal separator; other text unchanged. */
  numText(s: string | null | undefined): string | null;
  weekdays(width?: 'short' | 'long' | 'narrow'): [number, string][];
  months(width?: 'short' | 'long' | 'narrow'): string[];
  /** A unit in the interface language: 'Ед/л' → 'U/L' (units.js, displayUnit). */
  unit(u: string | null | undefined): string | null;
}

export const LANGUAGES: string[];
export const DATE_FORMATS: DateFormat[];
export const HOUR_CYCLES: HourCycle[];
export const WEEK_STARTS: WeekStart[];
export const LAB_UNIT_PREFS: LabUnitsPref[];
export const TEMPERATURE_PREFS: TemperaturePref[];
export const WEIGHT_PREFS: WeightPref[];
export const REGIONS: string[];
export const DEFAULT_LANGUAGE: string;
export const DEFAULT_PREFS: Readonly<RegionPrefs>;
export function normalizePrefs(p: unknown): RegionPrefs;
export function normalizeLanguage(l: unknown): string;
export function regionLocale(region: string): string;
export function guessRegion(browserLocale: string): string;
export function createFormat(opts?: { language?: string; prefs?: Partial<RegionPrefs> | null; timeZone?: string }): Format;
