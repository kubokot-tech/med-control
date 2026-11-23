import type { Format } from '../../../shared/format.js';

/** Shared flag and request utilities for the Labs module (dates and numbers: useFormat() in ui/format.tsx) */

/** Change since the previous value with a sign, in the user's number format: «+7», «−2,5». */
export function fmtDelta(f: Format, d: number | null): string {
  if (d === null || Number.isNaN(d)) return '—';
  return f.number(d, { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
}

/** 'high' | 'low' | 'ok' against a range that may be open on one side ("up to 5" is (null, 5)); '' without a value or a range. */
export function flagFor(
  val: number | null | undefined,
  lo: number | null | undefined,
  hi: number | null | undefined,
): 'ok' | 'high' | 'low' | '' {
  if (val == null || (lo == null && hi == null)) return '';
  if (hi != null && val > hi) return 'high';
  if (lo != null && val < lo) return 'low';
  return 'ok';
}

/** A range as text in the user's number format: «3,4–20,5», «≤ 5», «≥ 1»; '' without one. */
export function refText(f: Format, lo: number | null | undefined, hi: number | null | undefined): string {
  const n = (x: number) => f.number(x, { maximumFractionDigits: 4 });
  if (lo != null && hi != null) return `${n(lo)}–${n(hi)}`;
  if (hi != null) return `≤ ${n(hi)}`;
  if (lo != null) return `≥ ${n(lo)}`;
  return '';
}

/**
 * A lab value as written: the number in the user's format, keeping «<» / «>» / «≤» / «≥» from the report («<0,6» stays
 * «<0,6», not «0,6»); text results (negative, traces) as they are; '—' without either.
 */
export function labValueText(f: Format, valueNum: number | string | null | undefined, valueText?: string | null): string {
  if (valueNum == null || valueNum === '') return f.numText(valueText ?? null) || '—';
  const cmp = /^\s*([<>≤≥]=?)/.exec(valueText || '')?.[1] || '';
  return `${cmp}${f.number(Number(valueNum), { maximumFractionDigits: 4 })}`;
}

/** Where a range comes from (lab_results_eff.ref_source); the words are refSource.* in labs.json. */
export const isRefSource = (s: string): s is 'user' | 'catalog' | 'lab' => s === 'user' || s === 'catalog' || s === 'lab';

/** The shortest password the gateway accepts when one is set or changed (gateway/src/lib/password.js). */
export const MIN_PASSWORD = 10;

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('dtc_token');
}

/**
 * After any sign-in: keep the session token and the «known device» mark (the gateway's sign-in lock then counts only
 * this device's address, so strangers cannot lock the owner out; the mark opens nothing by itself).
 */
export function signedIn(j: { token: string; device?: string }) {
  localStorage.setItem('dtc_token', j.token);
  try { if (j.device) localStorage.setItem('dtc_device', j.device); } catch { /* private mode */ }
}

/** The «known device» mark to send with a sign-in attempt. */
export function deviceMark(): string | undefined {
  try { return localStorage.getItem('dtc_device') || undefined; } catch { return undefined; }
}

export async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers, cache: 'no-store' });
  if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
    // Token expired or invalid: drop it and go to the login page.
    localStorage.removeItem('dtc_token');
    window.location.href = '/login';
  }
  return res;
}

/** Trigger a file download from a blob (used for ZIP exports and PDF attachments). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Open a stored attachment. Auth is a Bearer token, so a plain <a href> cannot reach the file:
 * we fetch it, then either show an image in a new tab or download anything else (PDF included).
 * Do not window.open a PDF blob: CSP object-src 'none' (edge/Caddyfile) makes Chrome/Arc dump the
 * bytes as text instead of opening the viewer.
 */
export async function openAttachment(a: {
  sha256: string;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<{ ok: true } | { ok: false; response: Response }> {
  const image = !!a.mimeType?.startsWith('image/');
  const r = await apiFetch(`/api/gateway/attachments/${a.sha256}${image ? '?inline=1' : ''}`);
  if (!r.ok) return { ok: false, response: r };
  const raw = await r.blob();
  const type = (a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : null) || raw.type || 'application/octet-stream';
  const blob = raw.type === type ? raw : new Blob([raw], { type });
  const ext = type === 'application/pdf' ? 'pdf' : type.startsWith('image/') ? type.split('/')[1]!.replace('jpeg', 'jpg') : 'bin';
  const name = a.filename || `${a.sha256.slice(0, 12)}.${ext}`;
  if (image) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    saveBlob(blob, name);
  }
  return { ok: true };
}
