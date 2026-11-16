/**
 * Who reads PDFs: pdf.js and the JavaScript port of the lab parsers inside the gateway (default, PDF_ENGINE=js), or the
 * Python ingestion service kept in reserve (PDF_ENGINE=python, compose profile «python»). Both give the same text and
 * the same shapes (pdfText.js replays pypdf), so callers do not care: lab parsing (labsCommit), the text layer of
 * attachments (extracts), the parser list. An install whose .env still says python but runs without the service
 * falls back to the gateway's own engine instead of failing.
 */
import { pdfTextPages } from './pdfText.js';
import { parseLabText, publicList } from './labParsers/index.js';

export const pdfEngine = () => (String(process.env.PDF_ENGINE || '').trim().toLowerCase() === 'python' ? 'python' : 'js');

let warned = false;
/** The ingestion service cannot be reached (not started, profile «python» off): a network error, not an HTTP status. */
async function reachIngestion(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    if (e?.name !== 'TypeError') throw e; // fetch reports a refused or unknown host as TypeError («fetch failed»)
    if (!warned) { warned = true; console.warn(`PDF_ENGINE=python, but ${ingestionUrl()} does not answer: reading PDFs in the gateway (start the «python» profile or set PDF_ENGINE=js)`); }
    return null;
  }
}
export const ingestionUrl = () => process.env.INGESTION_URL || 'http://ingestion:8000';

const failed = (detail) => Object.assign(new Error('ingestion failed'), { code: 'ingestion_failed', detail });

async function jsLabs(buf) {
  let text;
  try { text = (await pdfTextPages(buf)).text; } catch (e) { throw failed(`cannot read pdf: ${e.message}`); }
  const parsed = parseLabText(text);
  if (!parsed) throw failed('no observations parsed');
  return parsed;
}

async function jsPlainText(buf) {
  let pages;
  try { pages = (await pdfTextPages(buf)).pages.map((t) => t.trim()); } catch (e) { throw Object.assign(new Error(`cannot read pdf: ${e.message}`), { code: 'ingestion_failed' }); }
  const text = pages.map((t, i) => (t ? `<!-- страница ${i + 1} -->\n${t}` : null)).filter(Boolean).join('\n\n');
  return { pages: pages.length, chars: pages.reduce((n, t) => n + t.length, 0), text };
}

/**
 * Built-in parsers: { source, lab_name, doc_date, observations: [{ test_name_raw, result_text, result_num, unit_raw,
 * ref_text_raw, ref_low, ref_high }] }. Throws { code: 'ingestion_failed', detail } when nobody recognises the PDF
 * (the caller then tries the model).
 */
export async function parseLabsPdf(buf, filename, { fetchImpl = fetch } = {}) {
  if (pdfEngine() === 'js') return jsLabs(buf);
  const fd = new FormData();
  fd.set('file', new Blob([buf], { type: 'application/pdf' }), filename || 'upload.pdf');
  const r = await reachIngestion(fetchImpl, `${ingestionUrl()}/ingest/labs/pdf`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) });
  if (!r) return jsLabs(buf);
  if (!r.ok) throw failed(await r.text());
  return r.json(); // { sha256, source, lab_name, doc_date, observations }
}

/** Plain text page by page, as ingestion's /extract/pdf: { pages, chars, text } with «<!-- страница N -->» markers. */
export async function pdfPlainText(buf, filename, { fetchImpl = fetch } = {}) {
  if (pdfEngine() === 'js') return jsPlainText(buf);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), filename || 'file.pdf');
  const r = await reachIngestion(fetchImpl, `${ingestionUrl()}/extract/pdf`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60_000) });
  if (!r) return jsPlainText(buf);
  if (!r.ok) throw Object.assign(new Error(`ingestion ${r.status}`), { code: 'ingestion_failed' });
  return r.json();
}

/** Laboratories recognised without AI (Settings → «Лаборатории»): { available, engine, parsers }. */
export async function labParserList() {
  if (pdfEngine() === 'js') return { available: true, engine: 'js', parsers: publicList() };
  try {
    const r = await reachIngestion(fetch, `${ingestionUrl()}/parsers`, { signal: AbortSignal.timeout(5000) });
    if (!r) return { available: true, engine: 'js', parsers: publicList() };
    if (!r.ok) throw new Error(`ingestion ${r.status}`);
    return { available: true, engine: 'python', ...(await r.json()) };
  } catch {
    return { available: false, engine: 'python', parsers: [] };
  }
}

/** Deep health: the ingestion service when it is the engine, otherwise 'off'. */
export async function pdfEngineHealth() {
  if (pdfEngine() === 'js') return 'off';
  const r = await fetch(`${ingestionUrl()}/health`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return 'ok';
}
