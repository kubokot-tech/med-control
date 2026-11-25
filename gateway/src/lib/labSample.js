/**
 * An anonymized sample of a lab report, for adding support for a laboratory: the text layer with its lines kept (a
 * parser needs nothing else), everything personal removed. Works by allowlist: a word stays only if it is a known test
 * name, unit or service word of lab reports (labSampleWords.js, the marker catalog), anything else becomes a fixed mask,
 * so an unknown surname or street cannot pass by default. Every digit is random, dates and times are one fixed value.
 * Nothing is stored and nothing leaves the machine here; the user reads the result and decides (routes/labSample.js).
 * It cannot be proven complete for an unknown layout, which is why the person checks it before sending.
 */
import crypto from 'node:crypto';
import { CATALOG_SEED } from './catalogSeed.js';
import { SAMPLE_WORDS } from './labSampleWords.js';
import { pdfTextPages } from './pdfText.js';

export const SAMPLE_MIN_CHARS_PER_PAGE = 80; // below this the PDF is a scan: no text layer to build a sample from
export const SAMPLE_MAX_CHARS = 200_000;

const norm = (w) => w.toLowerCase().replace(/ё/g, 'е');
const WORD = /[\p{L}\p{M}][\p{L}\p{M}\p{N}]*/gu;

const allowed = new Set(SAMPLE_WORDS.map(norm));
for (const e of CATALOG_SEED) {
  for (const s of [e.name, e.short, e.key, ...(e.aliases || [])]) {
    for (const w of String(s || '').match(WORD) || []) allowed.add(norm(w));
  }
}

const DATE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
// powers of ten in units stay: «*10^9/л», «*109 кл/л», «10*3/мкл» tell a parser what the unit is
const POWER = /[*×]\s?10[\^*]?\d{0,2}(?!\d)|\b10[\^*]\d{1,2}(?!\d)|\b10\d{0,2}(?=\s?(?:кл|\/))/g;

const FIXED_DATE = '01.02.2026'; const FIXED_ISO = '2026-02-01'; const FIXED_TIME = '12:00';

const mask = (w) => {
  const latin = /^[A-Za-z]/.test(w);
  const [up, low] = latin ? ['X', 'x'] : ['Х', 'х']; // one fixed length: the length of a surname says something too
  if (w.length > 1 && w === w.toUpperCase()) return up.repeat(5);
  return w[0] === w[0].toUpperCase() ? up + low.repeat(4) : low.repeat(5);
};

function maskWords(line) {
  return line.replace(WORD, (w, at) => {
    if (!allowed.has(norm(w))) return mask(w);
    if (w.length > 1) return w;
    // an initial is a capital before a dot; keep a preposition, a letter of a unit or a name: «в эритроците», «г/л», «Д-димер», «(К)»
    const before = line[at - 1] || ''; const after = line[at + 1] || '';
    if (w === w.toLowerCase() && after !== '.') return w;
    return before === '/' || after === '/' || after === '-' || (before === '(' && after === ')') || /\d/.test(before) ? w : mask(w);
  });
}

/** One line: dates and times become fixed values, powers of ten in units stay, words and the remaining digits are replaced. */
function anonymizeLine(raw, randomDigit) {
  const held = [];
  const hide = (s, re) => s.replace(re, (m) => { held.push(m); return `\u0001${held.length - 1}\u0001`; });
  const line = raw.replace(/\u0001/g, ' ').replace(DATE, (d) => (d.includes('-') ? FIXED_ISO : FIXED_DATE)).replace(TIME, FIXED_TIME);
  const safe = hide(hide(line, /01\.02\.2026|2026-02-01|12:00/g), POWER);
  return maskWords(safe)
    .replace(/\u0001\d+\u0001|\p{N}/gu, (m) => (m.startsWith('\u0001') ? m : randomDigit()))
    .replace(/\u0001(\d+)\u0001/g, (_, i) => held[Number(i)]);
}

/** text → the anonymized text, line for line. randomDigit is replaceable so that tests are repeatable. */
export function anonymizeLabText(text, { randomDigit = () => String(crypto.randomInt(10)) } = {}) {
  return String(text).slice(0, SAMPLE_MAX_CHARS).split('\n').map((l) => anonymizeLine(l, randomDigit)).join('\n');
}

/** A PDF → { text, pages } of the sample. Throws { code: 'not_pdf' } for an unreadable file, { code: 'sample_no_text' } for a scan. */
export async function labSampleFromPdf(buf) {
  let read;
  try { read = await pdfTextPages(buf); } catch { throw Object.assign(new Error('unreadable PDF'), { code: 'not_pdf' }); }
  if (read.text.replace(/\s/g, '').length < SAMPLE_MIN_CHARS_PER_PAGE * Math.max(1, read.pages.length)) {
    throw Object.assign(new Error('no text layer'), { code: 'sample_no_text' });
  }
  return { text: anonymizeLabText(read.text), pages: read.pages.length };
}
