import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PARSERS, candidates, parseLabText, publicList, byId } from '../src/lib/labParsers/index.js';
import { pyFloat, strip, split, splitlines, ruDateIso } from '../src/lib/labParsers/py.js';

// Shared with the Python parsers (ingestion/tests); .expected.json comes from ingestion/tools/golden.py.
const FIXTURES = fileURLToPath(new URL('../../ingestion/tests/fixtures/', import.meta.url));
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.txt')).sort();

/** The JS side of ingestion/tools/golden.py expected_for(). */
function expectedFor(text) {
  const parses = {};
  for (const p of PARSERS) {
    try { parses[p.META.id] = p.parseText(text); } catch (e) { parses[p.META.id] = { error: e.name }; }
  }
  return { candidates: candidates(text).map((p) => p.META.id), parses };
}

test('JS parsers give the same JSON as the Python parsers on every shared fixture', () => {
  assert.ok(fixtures.length >= 5);
  for (const f of fixtures) {
    const text = readFileSync(path.join(FIXTURES, f), 'utf8');
    const expected = JSON.parse(readFileSync(path.join(FIXTURES, f.replace(/\.txt$/, '.expected.json')), 'utf8'));
    assert.deepEqual(expectedFor(text), expected, f);
  }
});

test('registry: same ids and public list as the Python registry', () => {
  assert.deepEqual(PARSERS.map((p) => p.META.id), ['helix_pdf_v1', 'hadassah_pdf_v1', 'dnkom_pdf_v1', 'mknc_pdf_v1']);
  for (const p of publicList()) assert.deepEqual(Object.keys(p), ['id', 'name', 'country', 'description']);
  assert.equal(byId('nope'), null);
});

test('parseLabText: the ingestion response shape, first parser with observations, null when nobody parses', () => {
  const helix = readFileSync(path.join(FIXTURES, 'helix_basic.txt'), 'utf8');
  const r = parseLabText(helix);
  assert.equal(r.source, 'helix_pdf_v1');
  assert.equal(r.doc_date, '2026-02-03');
  assert.deepEqual(r.observations[0], { test_name_raw: 'Гемоглобин', result_text: '132', result_num: 132, unit_raw: 'г/л', ref_text_raw: '117 - 160', ref_low: 117, ref_high: 160 });
  assert.equal(parseLabText(helix, 'mknc_pdf_v1'), null, 'a forced parser that finds nothing');
  assert.equal(parseLabText(readFileSync(path.join(FIXTURES, 'unknown.txt'), 'utf8')), null);
  assert.equal(parseLabText(readFileSync(path.join(FIXTURES, 'mknc_bad_date.txt'), 'utf8')), null, 'a parser that throws does not match');
  const hadassah = parseLabText(readFileSync(path.join(FIXTURES, 'hadassah_blood.txt'), 'utf8'));
  assert.equal(hadassah.source, 'hadassah_pdf_v1');
  assert.deepEqual(hadassah.observations[0], { test_name_raw: 'Лейкоциты (WBC)', result_text: '6,12', result_num: 6.12, unit_raw: '10^9/л', ref_text_raw: '3,70 - 9,50', ref_low: 3.7, ref_high: 9.5 });
});

test('Python semantics: float(), strip/split/splitlines, strptime', () => {
  for (const [s, v] of [['12', 12], ['1.', 1], ['.5', 0.5], ['+5', 5], ['1_000', 1000], ['1e3', 1000], ['0x1A', null], ['', null], ['-', null], ['inf', null], ['1,5', null]]) assert.equal(pyFloat(s), v, s);
  assert.equal(strip('  a \x1c'), 'a');
  assert.equal(strip('﻿a'), '﻿a', 'Python does not strip BOM');
  assert.deepEqual(split('  a \t b　c '), ['a', 'b', 'c']);
  assert.deepEqual(splitlines('a\r\nb\rc d\n'), ['a', 'b', 'c', 'd']);
  assert.equal(ruDateIso('05.03.2026'), '2026-03-05');
  assert.throws(() => ruDateIso('31.02.2026'), { name: 'ValueError' });
  assert.equal(strip('x'), 'x');
});

test('DNKOM names land in the right catalog rows, nucleated red cells never in the red cell series', async () => {
  const { canonicalKeyFor, loadCatalog } = await import('../src/lib/canonical.js');
  await loadCatalog({ query: async () => ({ rows: [] }) }).catch(() => {});
  assert.equal(canonicalKeyFor('Нормобласты (ядросодержащие эритроциты) (NRBC)'), null);
  assert.equal(canonicalKeyFor('Нормобласты, абс.'), null);
  assert.equal(canonicalKeyFor('Эритроциты (RBC)'), 'RBC');
  assert.equal(canonicalKeyFor('Нейтрофилы, абс.'), 'NEUT#');
  assert.equal(canonicalKeyFor('Нейтрофилы, %'), 'NEUT%');
  assert.equal(canonicalKeyFor('Холестерин-ЛПВП'), 'HDL');
  assert.equal(canonicalKeyFor('Холестерин-ЛПОНП'), 'VLDL');
  assert.equal(canonicalKeyFor('Сывороточное железо'), 'FE');
});
