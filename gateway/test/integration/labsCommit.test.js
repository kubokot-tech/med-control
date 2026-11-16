import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SKIP, USER_ID, PDF, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('labs'); });
after(async () => { if (db) await db.teardown(); });

const parsed = {
  source: 'mknc_pdf_v1', lab_name: 'МКНЦ', doc_date: '2026-02-03',
  observations: [
    { test_name_raw: 'АЛТ', result_text: '150', result_num: 150, unit_raw: 'Ед/л', ref_low: 0, ref_high: 41 },
    { test_name_raw: 'Гемоглобин', result_text: '110', result_num: 110, unit_raw: 'г/л', ref_low: 130, ref_high: 160 },
    { test_name_raw: 'Цвет', result_text: 'соломенно-жёлтый' },
  ],
};

test('commitParsed writes file, event, document, results, alerts; duplicates are rejected', { skip: SKIP }, async () => {
  const { commitParsed } = await import('../../src/lib/labsCommit.js');
  const r = await commitParsed({ userId: USER_ID, buf: PDF, filename: 'mknc.pdf', parsed });
  assert.equal(r.already, false);
  assert.equal(r.inserted, 2, 'qualitative colour row is skipped in lab_results');
  assert.equal(r.flagged.length, 2);
  assert.ok(r.alertsRaised >= 1, 'ALT above three ULN raises an alert');
  assert.ok(existsSync(path.join(process.env.DTC_DATA_DIR, 'uploads', `${r.sha256}.pdf`)));

  const ev = await db.pool.query('select type, meta, notes from events where id=$1', [r.eventId]);
  assert.equal(ev.rows[0].type, 'LAB_RESULT');
  assert.equal(ev.rows[0].meta.lab, 'МКНЦ');
  const doc = await db.pool.query('select event_id, lab_name, doc_date::text as doc_date from ingest_documents where id=$1', [r.documentId]);
  assert.equal(doc.rows[0].event_id, r.eventId);
  assert.equal(doc.rows[0].doc_date, '2026-02-03');
  const res = await db.pool.query('select document_id, source_event_id, value_numeric::float as v, unit_canonical from lab_results where user_id=$1 order by v', [USER_ID]);
  assert.equal(res.rows.length, 2);
  assert.ok(res.rows.every((x) => x.document_id === r.documentId && x.source_event_id === r.eventId));
  const raw = await db.pool.query('select count(*)::int as n from ingest_observations_raw where document_id=$1', [r.documentId]);
  assert.equal(raw.rows[0].n, 3);
  const att = await db.pool.query('select count(*)::int as n from attachments where event_id=$1 and sha256=$2', [r.eventId, r.sha256]);
  assert.equal(att.rows[0].n, 1);
  const alerts = await db.pool.query(`select context->>'severity' as sev from alerts where user_id=$1`, [USER_ID]);
  assert.ok(alerts.rows.some((a) => a.sev === 'RED'));

  const again = await commitParsed({ userId: USER_ID, buf: PDF, filename: 'mknc.pdf', parsed });
  assert.equal(again.already, true);
  assert.equal(again.documentId, r.documentId);
  const docs = await db.pool.query('select count(*)::int as n from ingest_documents where user_id=$1', [USER_ID]);
  assert.equal(docs.rows[0].n, 1);
});

test('commitParsed refuses non-PDF bytes and bad dates', { skip: SKIP }, async () => {
  const { commitParsed } = await import('../../src/lib/labsCommit.js');
  await assert.rejects(commitParsed({ userId: USER_ID, buf: Buffer.from('hello'), filename: 'x.pdf', parsed }), (e) => e.code === 'not_pdf');
  const other = Buffer.concat([PDF, Buffer.from('second')]);
  const r = await commitParsed({ userId: USER_ID, buf: other, filename: 'y.pdf', parsed: { ...parsed, doc_date: '03.02.2026' } });
  assert.equal(r.docDate, null, 'unparseable date is dropped, not stored');
});
