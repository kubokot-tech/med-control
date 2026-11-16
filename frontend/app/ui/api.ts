import { createTranslator } from 'use-intl/core';
import { apiFetch } from './labUtils';
import { DEFAULT_LANGUAGE, LANGUAGES, activeLanguage } from '../i18n/messages';

// Plain module outside React (no IntlProvider here): the language I18nProvider last rendered.
const errors = () => LANGUAGES[activeLanguage()].errors as Record<string, string>;
const t = (key: 'errorCode', args: { code: string }) => createTranslator({ locale: activeLanguage(), messages: LANGUAGES[activeLanguage()], namespace: 'ui.api' })(key, args);

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status; }
}

/**
 * Text for an API error body ({error, message}) or a thrown error, in the language of the interface. The gateway's
 * `message` is Russian, so another language goes by the code first.
 */
export function errorRu(j: any, fallback?: string): string {
  if (j instanceof ApiError) return j.message;
  const dict = errors();
  if (j instanceof Error) return dict[j.message] || j.message || fallback || dict.failed;
  const code = j?.error as string | undefined;
  if (code && dict[code] && activeLanguage() !== DEFAULT_LANGUAGE) return dict[code];
  return (j?.message as string) || (code ? dict[code] || t('errorCode', { code }) : fallback || dict.failed);
}

/** fetch + JSON parse; throws ApiError with a readable message on any non-2xx or network failure. */
export async function apiJson<T = any>(path: string, opts?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await apiFetch(path, opts); }
  catch { throw new ApiError('network', errors().network, 0); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'http', errorRu(j, `${errors().http} (${r.status})`), r.status);
  return j as T;
}

/** Timezone from the JWT (tz claim), default Europe/Moscow. */
export function userTz(): string {
  try {
    const t = typeof window !== 'undefined' ? localStorage.getItem('dtc_token') : null;
    if (!t) return 'Europe/Moscow';
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.tz || 'Europe/Moscow';
  } catch { return 'Europe/Moscow'; }
}

/** YYYY-MM-DD for a date in the user's timezone (not UTC). */
export function dayKey(d: Date = new Date(), tz: string = userTz()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const todayKey = (): string => dayKey(new Date());
export function addDays(key: string, n: number): string {
  const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
