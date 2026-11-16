/**
 * Python string semantics the parsers rely on (they are ports of ingestion/app/connectors/*.py and must give the
 * same JSON on the shared fixtures): str.strip/split/splitlines whitespace, float(), \b around Cyrillic words,
 * strptime('%d.%m.%Y').
 */

// str.isspace() characters
const WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP_RX = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const SPLIT_RX = new RegExp(`[${WS}]+`);
// str.splitlines() boundaries
const LINES_RX = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

export const strip = (s) => String(s).replace(STRIP_RX, '');
/** str.split() without arguments: runs of whitespace, no empty strings. */
export const split = (s) => { const t = strip(s); return t ? t.split(SPLIT_RX) : []; };
export function splitlines(s) {
  const parts = String(s).split(LINES_RX);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}
/** The end of a word for \b after Cyrillic letters (JS \b only knows ASCII word characters). */
export const WORD_END = '(?![\\p{L}\\p{N}_])';

const FLOAT_RX = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
/** float(s) or null when Python would raise (inf and nan are not real lab values and give null as well). */
export function pyFloat(s) {
  const t = strip(s);
  if (!FLOAT_RX.test(t)) return null;
  const n = Number(t.replace(/_/g, ''));
  return Number.isFinite(n) ? n : null;
}

const valueError = (msg) => Object.assign(new Error(msg), { name: 'ValueError' });

/** datetime.strptime(s, '%d.%m.%Y').date().isoformat(); throws like Python on an impossible date. */
export function ruDateIso(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (!m) throw valueError(`time data '${s}' does not match format '%d.%m.%Y'`);
  const [, d, mo, y] = m.map(Number);
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  if (y < 1 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw valueError(`day is out of range for month: '${s}'`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}
