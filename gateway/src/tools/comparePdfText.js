/**
 * Compare the two PDF engines on one real report: the text layer and the parse from the Python ingestion service
 * (pypdf + ingestion/app/connectors) against pdf.js + the JS port (src/lib/pdfText.js, src/lib/labParsers).
 * Prints only differences and a verdict; exit code 0 when the parses match, 1 when they differ, 2 on errors.
 * The report never leaves the stack (the gateway talks to ingestion on the internal network).
 *
 *   docker compose exec -T gateway node src/tools/comparePdfText.js < report.pdf
 *   docker compose exec -T gateway node src/tools/comparePdfText.js --text < report.pdf   # also print both text layers
 */
import { readFileSync } from 'node:fs';
import { pdfTextPages } from '../lib/pdfText.js';
import { parseLabText } from '../lib/labParsers/index.js';
import { ingestionUrl } from '../lib/pdfEngine.js';

const showText = process.argv.includes('--text');
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const buf = file ? readFileSync(file) : readFileSync(0);
if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.error('not a PDF'); process.exit(2); }

const post = async (path) => {
  const fd = new FormData();
  fd.set('file', new Blob([buf], { type: 'application/pdf' }), 'report.pdf');
  const r = await fetch(`${ingestionUrl()}${path}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : await r.text() };
};
const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);

const js = await pdfTextPages(buf);
let pyText = null;
try {
  const r = await post('/extract/pdf');
  // /extract/pdf marks pages; drop the markers to compare with the plain layer the parsers get
  if (r.ok) pyText = r.body.text.split('\n').filter((l) => !/^<!-- страница \d+ -->$/.test(l)).join('\n');
  else console.log(`ingestion /extract/pdf: http ${r.status}`);
} catch (e) { console.log(`ingestion unreachable (${e.message}): only the JS side is shown`); }

if (showText) {
  console.log('--- pdf.js text layer ---');
  console.log(js.text);
  if (pyText != null) { console.log('--- pypdf text layer ---'); console.log(pyText); }
}

if (pyText != null) {
  const a = lines(pyText); const b = lines(js.text);
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(`  line ${i + 1}\n    pypdf: ${a[i] ?? '∅'}\n    pdf.js: ${b[i] ?? '∅'}`);
  console.log(diff.length ? `text layers differ in ${diff.length} of ${Math.max(a.length, b.length)} lines (first 10):\n${diff.slice(0, 10).join('\n')}` : `text layers match (${a.length} lines)`);
}

const jsParse = parseLabText(js.text);
let pyParse = null;
try {
  const r = await post('/ingest/labs/pdf');
  pyParse = r.ok ? r.body : null;
  if (!r.ok) console.log(`python parsers: nothing recognised (http ${r.status})`);
} catch { /* reported above */ }
console.log(`js parsers: ${jsParse ? `${jsParse.source}, ${jsParse.observations.length} rows, ${jsParse.lab_name || '—'}, ${jsParse.doc_date || '—'}` : 'nothing recognised'}`);
if (pyParse) console.log(`python parsers: ${pyParse.source}, ${pyParse.observations.length} rows, ${pyParse.lab_name || '—'}, ${pyParse.doc_date || '—'}`);

const strip = (p) => p && { source: p.source, lab_name: p.lab_name ?? null, doc_date: p.doc_date ?? null, observations: p.observations.map((o) => ({ test_name_raw: o.test_name_raw, result_text: o.result_text ?? null, result_num: o.result_num ?? null, unit_raw: o.unit_raw ?? null, ref_text_raw: o.ref_text_raw ?? null, ref_low: o.ref_low ?? null, ref_high: o.ref_high ?? null })) };
const same = JSON.stringify(strip(jsParse)) === JSON.stringify(strip(pyParse));
if (pyParse || jsParse) {
  if (!same && jsParse && pyParse) {
    const n = Math.max(jsParse.observations.length, pyParse.observations.length);
    for (let i = 0; i < n; i++) {
      const x = JSON.stringify(strip(pyParse).observations[i] ?? null); const y = JSON.stringify(strip(jsParse).observations[i] ?? null);
      if (x !== y) console.log(`  row ${i + 1}\n    python: ${x}\n    js:     ${y}`);
    }
  }
  console.log(same ? 'VERDICT: parses match' : 'VERDICT: parses differ');
}
process.exit(same ? 0 : 1);
