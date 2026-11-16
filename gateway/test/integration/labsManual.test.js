import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('labsmanual'); });
after(async () => { if (db) await db.teardown(); });

test('manual entry: catalog markers by key, units converted, bounds kept, text results, own names, no file', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const r = await commitManual(USER_ID, { date: '2026-03-04', labName: 'Поликлиника', rows: [
    { key: 'ALT', value: '52' },
    { key: 'GLU', value: '99', unit: 'мг/дл' },
    { key: 'CRP', value: '<0,6' },
    { name: 'Прокальцитонин', value: '0,05', unit: 'нг/мл', refHigh: 0.5 },
    { key: 'HGB', value: '' },
  ] }, { tz: 'Europe/Moscow' });
  assert.equal(r.inserted, 4, 'the empty row is skipped');
  assert.ok(r.flagged.some((x) => x.name.includes('АЛТ')), 'ALT 52 is above the range in force');
  const rows = await db.pool.query(`select t.canonical_key as key, t.code, r.value_numeric::float as v, r.value_text, r.unit_canonical from lab_results r join lab_tests t on t.id = r.test_id order by t.code`);
  const by = Object.fromEntries(rows.rows.map((x) => [x.key || x.code, x]));
  assert.equal(by.ALT.v, 52);
  assert.ok(Math.abs(by.GLU.v - 5.49) < 0.02, 'mg/dL converted to mmol/L');
  assert.equal(by.GLU.unit_canonical, 'ммоль/л');
  assert.equal(by.CRP.v, 0.6);
  assert.equal(by.CRP.value_text, '<0,6');
  assert.equal(by['Прокальцитонин'].v, 0.05);
  const doc = await db.pool.query('select source, lab_name, doc_date::text as d from ingest_documents where id = $1', [r.documentId]);
  assert.deepEqual(doc.rows[0], { source: 'manual', lab_name: 'Поликлиника', d: '2026-03-04' });
  const att = await db.pool.query('select count(*)::int as n from attachments');
  assert.equal(att.rows[0].n, 0, 'no file');
  const ev = await db.pool.query(`select title from events where type = 'LAB_RESULT'`);
  assert.equal(ev.rows[0].title, 'Лабы (вручную)');
});

test('manual entry refuses a future date, an unknown key and empty input', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const code = (c) => (e) => e.name === 'CoreError' && e.code === c;
  await assert.rejects(commitManual(USER_ID, { date: '2999-01-01', rows: [{ key: 'ALT', value: '1' }] }), code('future_date'));
  await assert.rejects(commitManual(USER_ID, { date: '2026-01-01', rows: [{ key: 'NOPE', value: '1' }] }), code('unknown_key'));
  await assert.rejects(commitManual(USER_ID, { date: '2026-01-01', rows: [{ key: 'ALT', value: ' ' }] }), code('nothing_to_save'));
  await assert.rejects(commitManual(USER_ID, { date: '03.01.2026', rows: [{ key: 'ALT', value: '1' }] }), code('bad_date'));
});
