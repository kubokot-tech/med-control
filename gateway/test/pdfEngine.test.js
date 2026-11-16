import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pdfEngine, parseLabsPdf, pdfPlainText } from '../src/lib/pdfEngine.js';

const ROWS = readFileSync(fileURLToPath(new URL('../../ingestion/tests/fixtures/pdf/rows.pdf', import.meta.url)));
const withEngine = async (value, fn) => {
  const saved = process.env.PDF_ENGINE;
  if (value === undefined) delete process.env.PDF_ENGINE; else process.env.PDF_ENGINE = value;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.PDF_ENGINE; else process.env.PDF_ENGINE = saved; }
};

test('the gateway reads PDFs itself unless PDF_ENGINE=python', () => withEngine(undefined, async () => {
  assert.equal(pdfEngine(), 'js');
  process.env.PDF_ENGINE = 'PYTHON';
  assert.equal(pdfEngine(), 'python');
  process.env.PDF_ENGINE = 'js';
  assert.equal(pdfEngine(), 'js');
}));

test('PDF_ENGINE=python without the ingestion service falls back to the gateway engine; its HTTP errors still fail', () => withEngine('python', async () => {
  const down = async () => { throw new TypeError('fetch failed'); };
  const parsed = await parseLabsPdf(ROWS, 'rows.pdf', { fetchImpl: down });
  assert.equal(parsed.source, 'helix_pdf_v1');
  const plain = await pdfPlainText(ROWS, 'rows.pdf', { fetchImpl: down });
  assert.match(plain.text, /^<!-- страница 1 -->\n[\s\S]*Гемоглобин/);
  const broken = async () => new Response('boom', { status: 500 });
  await assert.rejects(parseLabsPdf(ROWS, 'rows.pdf', { fetchImpl: broken }), (e) => e.code === 'ingestion_failed');
}));
