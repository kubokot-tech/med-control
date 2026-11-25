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

test('laboratory calendar date survives import in western and eastern time zones', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { dayKey } = await import('../../src/lib/dates.js');
  for (const tz of ['America/New_York', 'Pacific/Kiritimati', 'Etc/GMT+12']) {
    await db.pool.query('update users set timezone=$2 where id=$1', [USER_ID, tz]);
    const day = '2026-01-01';
    const result = await commitManual(USER_ID, { date: day, rows: [{ key: 'ALT', value: '20', unit: 'Ед/л' }] }, { tz });
    const event = (await db.pool.query('select occurred_at from events where id=$1', [result.eventId])).rows[0];
    assert.equal(dayKey(event.occurred_at, tz), day);
    assert.equal(dayKey(event.occurred_at, 'UTC'), day);
  }
});

test('normalization preserves bounds and old lost signs recover only from the original observation', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { renormalizeUnits } = await import('../../src/lib/units.js');
  const { readFile } = await import('node:fs/promises');
  const result = await commitManual(USER_ID, { date: '2026-01-18', rows: [{ key: 'HGB', value: '<=9', unit: 'g/dL' }] });
  const args = [result.documentId];
  const stored = async () => (await db.pool.query('select value_text from lab_results where document_id=$1', args)).rows[0].value_text;
  assert.equal(await stored(), '<=90');
  await db.pool.query("update lab_results set value_text='<=9', value_numeric=9, unit_canonical=unit_original where document_id=$1", args);
  await renormalizeUnits(db.pool, db.quiet);
  assert.equal(await stored(), '<=90');
  const sql = await readFile(new URL('../../../db/migrations/039_restore_lab_comparators.sql', import.meta.url), 'utf8');
  await db.pool.query("update lab_results set value_text='90' where document_id=$1", args);
  await db.pool.query(sql);
  assert.equal(await stored(), '<=90');
  await db.pool.query("update lab_results set value_text='<=9' where document_id=$1", args);
  await db.pool.query(sql);
  assert.equal(await stored(), '<=90');
  await db.pool.query('insert into ingest_observations_raw(document_id,test_name_raw,result_text,result_num,unit_raw) select document_id,test_name_raw,\'9\',9,unit_raw from ingest_observations_raw where document_id=$1', args);
  await db.pool.query("update lab_results set value_text='90' where document_id=$1", args);
  await db.pool.query(sql);
  assert.equal(await stored(), '90');
});

test('worst result distinguishes a conclusive low bound from an indeterminate interval', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { buildSummary } = await import('../../src/lib/labsSummary.js');
  const marker = 'Synthetic interval';
  for (const [date, value] of [['2026-01-04', '<3.9'], ['2026-01-05', '>2'], ['2026-01-06', '5']]) {
    await commitManual(USER_ID, { date, rows: [{ name: marker, value, unit: 'U/L', refLow: 3.9, refHigh: 6.1 }] });
  }
  const summary = await buildSummary({ userId: USER_ID, pick: 'worst', range: 'all' });
  const cell = summary.rows.find((r) => r.test === marker).cells['2026-01'];
  assert.equal(cell.valueText, '<3.9');
});
