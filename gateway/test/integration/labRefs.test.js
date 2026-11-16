import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, PDF, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('labrefs'); });
after(async () => { if (db) await db.teardown(); });

// Two labs with their own ALT range; haemoglobin has only by-sex built-in ranges; PDW has none; a unit that does not
// convert to the catalog one keeps the lab's range.
const doc = (lab, date, altHigh, extra = []) => ({
  source: 'mknc_pdf_v1', lab_name: lab, doc_date: date,
  observations: [
    { test_name_raw: 'АЛТ', result_text: '45', result_num: 45, unit_raw: 'Ед/л', ref_low: 0, ref_high: altHigh },
    { test_name_raw: 'Гемоглобин', result_text: '125', result_num: 125, unit_raw: 'г/л', ref_low: 120, ref_high: 160 },
    ...extra,
  ],
});

const inForce = async (key) => (await db.pool.query(
  `select r.ref_low::float as lo, r.ref_high::float as hi, r.ref_source as src, r.lab_ref_high::float as lab_hi, r.lab_name
   from lab_results_eff r join lab_tests t on t.id = r.test_id where t.canonical_key = $1 order by r.collected_at`, [key])).rows;

test('ranges in force: built-in by sex, own range, «as the lab», the lab when there is no built-in one', { skip: SKIP }, async () => {
  const { commitParsed } = await import('../../src/lib/labsCommit.js');
  const refs = await import('../../src/lib/labRefs.js');

  const a = await commitParsed({ userId: USER_ID, buf: PDF, filename: 'a.pdf', parsed: doc('Лаборатория А', '2026-02-03', 50) });
  await commitParsed({ userId: USER_ID, buf: Buffer.concat([PDF, Buffer.from('b')]), filename: 'b.pdf', parsed: doc('Лаборатория Б', '2026-03-03', 40, [
    { test_name_raw: 'PDW', result_text: '16', result_num: 16, unit_raw: 'фл', ref_low: 9, ref_high: 17 },
  ]) });

  // sex not given: ALT uses the built-in range for any sex (≤ 40) in both labs, so 45 is high in both
  let alt = await inForce('ALT');
  assert.deepEqual(alt.map((x) => [x.lo, x.hi, x.src, x.lab_hi]), [[null, 40, 'catalog', 50], [null, 40, 'catalog', 40]]);
  assert.deepEqual(a.flagged.map((f) => f.name).sort(), ['Аланинаминотрансфераза (АЛТ)']);
  // haemoglobin: only by-sex ranges, so without the sex it is the lab's
  assert.deepEqual((await inForce('HGB')).map((x) => [x.lo, x.hi, x.src]), [[120, 160, 'lab'], [120, 160, 'lab']]);

  await refs.setSex(USER_ID, 'f');
  alt = await inForce('ALT');
  assert.deepEqual(alt.map((x) => [x.hi, x.src]), [[33, 'catalog'], [33, 'catalog']]);
  assert.deepEqual((await inForce('HGB')).map((x) => [x.lo, x.hi, x.src]), [[120, 150, 'catalog'], [120, 150, 'catalog']]);

  // own range wins; one side may stay open
  await refs.setOverride(USER_ID, 'ALT', { low: null, high: 55 });
  assert.deepEqual((await inForce('ALT')).map((x) => [x.lo, x.hi, x.src]), [[null, 55, 'user'], [null, 55, 'user']]);
  // «as printed by the lab»: each result its own laboratory's range again
  await refs.setOverride(USER_ID, 'ALT', { mode: 'lab' });
  assert.deepEqual((await inForce('ALT')).map((x) => [x.hi, x.src]), [[50, 'lab'], [40, 'lab']]);
  await refs.clearOverride(USER_ID, 'ALT');
  assert.deepEqual((await inForce('ALT')).map((x) => x.src), ['catalog', 'catalog']);

  // PDW: no built-in range, keeps the lab's; an own range does not apply to a unit the catalog does not have
  assert.deepEqual((await inForce('PDW')).map((x) => [x.lo, x.hi, x.src]), [[9, 17, 'lab']]);
  await refs.setOverride(USER_ID, 'PDW', { low: 10, high: 15 });
  assert.deepEqual((await inForce('PDW')).map((x) => x.src), ['lab'], 'PDW in фл is not the catalog % — the own range would not fit');

  // the feed counts out-of-range results by the ranges in force
  const feed = await db.pool.query(`select count(*) filter (where r.value_numeric > r.ref_high or r.value_numeric < r.ref_low)::int as n
                                    from lab_results_eff r where r.source_event_id = $1`, [a.eventId]);
  assert.equal(feed.rows[0].n, 1, 'ALT 45 > 33; haemoglobin 125 within 120–150');

  // settings as the screen sees them
  const s = await refs.getRefSettings(USER_ID);
  assert.equal(s.sex, 'f');
  const altItem = s.items.find((x) => x.key === 'ALT');
  assert.deepEqual(altItem.inForce, { low: null, high: 33, source: 'catalog' });
  assert.deepEqual(altItem.builtIn.m, { low: null, high: 41 });
  assert.deepEqual(s.items.find((x) => x.key === 'PDW').override.mode, 'custom');
});

test('invalid ranges and unknown markers are refused', { skip: SKIP }, async () => {
  const refs = await import('../../src/lib/labRefs.js');
  const code = (c) => (e) => e.name === 'CoreError' && e.code === c;
  await assert.rejects(refs.setOverride(USER_ID, 'ALT', { low: 50, high: 10 }), code('bad_ref_range'));
  await assert.rejects(refs.setOverride(USER_ID, 'ALT', {}), code('bad_ref_range'));
  await assert.rejects(refs.setOverride(USER_ID, 'ALT', { low: 'abc' }), code('bad_ref_range'));
  await assert.rejects(refs.setOverride(USER_ID, 'NOPE', { low: 1 }), code('unknown_key'));
  await assert.rejects(refs.setOverride(USER_ID, 'ALT', { mode: 'x' }), code('invalid_body'));
  await assert.rejects(refs.setSex(USER_ID, 'x'), code('invalid_body'));
});

test('alerts on upload use the range in force', { skip: SKIP }, async () => {
  const { commitParsed } = await import('../../src/lib/labsCommit.js');
  const refs = await import('../../src/lib/labRefs.js');
  await db.pool.query('delete from alerts');
  // the lenvatinib-style rule «ALT above 3 ULN»: 100 is below 3 × 41 by the lab, above 3 × 30 by the own range
  await refs.setOverride(USER_ID, 'ALT', { high: 30 });
  const { setProtocol, protocolFromPreset } = await import('../../src/lib/protocol.js');
  await setProtocol(protocolFromPreset('lenvatinib'));
  await commitParsed({ userId: USER_ID, buf: Buffer.concat([PDF, Buffer.from('c')]), filename: 'c.pdf', parsed: {
    source: 'mknc_pdf_v1', lab_name: 'Лаборатория В', doc_date: '2026-04-01',
    observations: [{ test_name_raw: 'АЛТ', result_text: '100', result_num: 100, unit_raw: 'Ед/л', ref_low: 0, ref_high: 41 }],
  } });
  const al = await db.pool.query(`select context->>'refHigh' as hi from alerts where user_id = $1 and context->>'key' = 'ALT'`, [USER_ID]);
  assert.ok(al.rows.length >= 1, 'an ALT alert is raised against the own range');
  assert.ok(al.rows.every((x) => Number(x.hi) === 30));
});

test('in US lab units: series, summary and own ranges convert; the database stays in SI', { skip: SKIP }, async () => {
  const { commitParsed } = await import('../../src/lib/labsCommit.js');
  const { setUserLocale } = await import('../../src/lib/userLocale.js');
  const { userLabUnits, displayPoint } = await import('../../src/lib/labDisplay.js');
  const { buildSummary } = await import('../../src/lib/labsSummary.js');
  await commitParsed({ userId: USER_ID, buf: Buffer.concat([PDF, Buffer.from('glu')]), filename: 'g.pdf', parsed: {
    source: 'mknc_pdf_v1', lab_name: 'Лаборатория Г', doc_date: '2026-05-05',
    observations: [{ test_name_raw: 'Глюкоза', result_text: '5.5', result_num: 5.5, unit_raw: 'ммоль/л', ref_low: 3.9, ref_high: 6.1 }],
  } });
  await setUserLocale(USER_ID, { prefs: { labUnits: 'conventional' } });
  const u = await userLabUnits(USER_ID);
  const p = displayPoint(u, 'GLU', { valueNum: 5.5, refLow: 3.9, refHigh: 6.1, unit: 'ммоль/л', delta: null });
  assert.deepEqual([p.valueNum, p.refLow, p.refHigh, p.unit], [99, 70, 110, 'мг/дл']);
  const s = await buildSummary({ userId: USER_ID, pick: 'worst', range: 'all' });
  const glu = s.rows.find((r) => r.test === 'GLU');
  assert.equal(glu.unit, 'мг/дл');
  assert.equal(Object.values(glu.cells)[0].valueNum, 99);
  const raw = await db.pool.query(`select r.value_numeric::float as v from lab_results r join lab_tests t on t.id = r.test_id where t.canonical_key = 'GLU'`);
  assert.equal(raw.rows[0].v, 5.5);
  // an own range typed in mg/dL is stored in mmol/L
  const refs = await import('../../src/lib/labRefs.js');
  await refs.setOverride(USER_ID, 'GLU', { low: u.fromDisplay('GLU', 72), high: u.fromDisplay('GLU', 99) });
  const o = await db.pool.query(`select ref_high::float as hi from lab_ref_overrides where key = 'GLU'`);
  assert.ok(Math.abs(o.rows[0].hi - 5.495) < 0.01);
  await setUserLocale(USER_ID, { prefs: { labUnits: 'auto' } });
});
