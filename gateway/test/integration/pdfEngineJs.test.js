import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
const PDF = readFileSync(fileURLToPath(new URL('../../../ingestion/tests/fixtures/pdf/rows.pdf', import.meta.url)));
const FLOW = readFileSync(fileURLToPath(new URL('../../../ingestion/tests/fixtures/pdf/flow.pdf', import.meta.url)));
before(async () => { if (!SKIP) { db = await setupDb('pdfjs'); process.env.PDF_ENGINE = 'js'; } });
after(async () => { delete process.env.PDF_ENGINE; if (db) await db.teardown(); });

const noNetwork = async () => { throw new Error('the ingestion service must not be called'); };

test('PDF_ENGINE=js: a lab PDF is parsed and committed without the ingestion service', { skip: SKIP }, async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = noNetwork;
  try {
    const { commitLabsPdf } = await import('../../src/lib/labsCommit.js');
    const r = await commitLabsPdf({ userId: USER_ID, buf: PDF, filename: 'helix.pdf' });
    assert.equal(r.inserted, 3);
    assert.equal(r.labName, 'Хеликс');
    assert.equal(r.docDate, '2026-04-14');
    const doc = await db.pool.query('select source from ingest_documents where id = $1', [r.documentId]);
    assert.equal(doc.rows[0].source, 'helix_pdf_v1');
    const ev = await db.pool.query('select source from events where id = $1', [r.eventId]);
    assert.equal(ev.rows[0].source, 'ingestion:helix_pdf_v1', 'same event source as the Python path (the labs summary relies on it)');
    await assert.rejects(commitLabsPdf({ userId: USER_ID, buf: FLOW, filename: 'flow.pdf' }), (e) => e.code === 'ingestion_failed', 'unknown layout and no AI key');
    const { labParserList } = await import('../../src/lib/pdfEngine.js');
    const list = await labParserList();
    assert.equal(list.engine, 'js');
    assert.deepEqual(list.parsers.map((p) => p.id), ['helix_pdf_v1', 'hadassah_pdf_v1', 'dnkom_pdf_v1', 'mknc_pdf_v1']);
  } finally { globalThis.fetch = realFetch; }
});

test('PDF_ENGINE=js: the text layer of an attachment comes from pdf.js, page by page', { skip: SKIP }, async () => {
  const { transaction } = await import('../../src/lib/db.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const { addEvent } = await import('../../src/lib/feed.js');
  const { extractBySha } = await import('../../src/lib/extracts.js');
  const att = await transaction(async (c) => storeAttachment(c, USER_ID, await addEvent(c, USER_ID, { type: 'NOTE', occurredAt: '2026-02-02T10:00:00Z', title: 'x' }), FLOW, 'application/pdf', 'flow.pdf'));
  const x = await extractBySha(USER_ID, att.sha256, { mode: 'text', fetchImpl: noNetwork });
  assert.equal(x.method, 'pdf_text');
  assert.match(x.text, /^<!-- страница 1 -->\nЗарегистрирован: 03\.02\.2026 08:15\n/);
  assert.match(x.text, /\n\n<!-- страница 2 -->\nВторая страница: Тромбоциты 210/);
});
