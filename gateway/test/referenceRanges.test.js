import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_RANGES, builtInRange, referenceRange } from '../src/lib/referenceRanges.js';
import { entry } from '../src/lib/canonical.js';
import { flag, refText } from '../src/lib/labsQuery.js';
import { refsTableMarkdown } from '../src/tools/refsTable.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('every built-in range belongs to a catalog marker with a unit and is a sane interval', () => {
  for (const [key, r] of Object.entries(REFERENCE_RANGES)) {
    const e = entry(key);
    assert.ok(e, `${key} is not in the catalog`);
    assert.equal(typeof (e.unit ?? ''), 'string', `${key}: a range is in the catalog unit`);
    const sides = Object.entries(r);
    assert.ok(sides.length, key);
    for (const [who, pair] of sides) {
      assert.ok(['any', 'm', 'f'].includes(who), `${key}.${who}`);
      assert.equal(pair.length, 2, `${key}.${who}`);
      const [lo, hi] = pair;
      assert.ok(lo != null || hi != null, `${key}.${who}: both sides open`);
      for (const x of pair) assert.ok(x == null || (typeof x === 'number' && Number.isFinite(x) && x >= 0), `${key}.${who}: ${x}`);
      if (lo != null && hi != null) assert.ok(lo < hi, `${key}.${who}: ${lo} ≥ ${hi}`);
    }
  }
});

test('the range for a sex falls back to the one for any sex, and to nothing', () => {
  assert.deepEqual(builtInRange('ALT', 'f'), { low: null, high: 33 });
  assert.deepEqual(builtInRange('ALT', null), { low: null, high: 40 });
  assert.deepEqual(builtInRange('BIL', 'm'), { low: 3.4, high: 20.5 });
  assert.equal(builtInRange('HGB', null), null, 'haemoglobin has no range for an unknown sex');
  assert.deepEqual(builtInRange('HGB', 'm'), { low: 130, high: 170 });
  assert.equal(builtInRange('TAC', 'm'), null, 'drug levels are left to the lab and the protocol');
  assert.equal(referenceRange('NOPE'), null);
});

test('flags and range text work with ranges open on one side', () => {
  assert.equal(flag(6, null, 5), 'high');
  assert.equal(flag(4, null, 5), 'ok');
  assert.equal(flag(0.9, 1.0, null), 'low');
  assert.equal(flag(1.4, 1.0, null), 'ok');
  assert.equal(flag(5, null, null), '');
  assert.equal(flag(null, 1, 2), '');
  assert.equal(refText(3.4, 20.5), '3.4–20.5');
  assert.equal(refText(null, 5), '≤ 5');
  assert.equal(refText(1, null), '≥ 1');
  assert.equal(refText(null, null), '');
});

test('docs/REFERENCE-RANGES.md shows the ranges the code uses', () => {
  const doc = readFileSync(fileURLToPath(new URL('../../docs/REFERENCE-RANGES.md', import.meta.url)), 'utf8');
  const block = doc.split('<!-- refs:begin -->')[1]?.split('<!-- refs:end -->')[0]?.trim();
  assert.equal(block, refsTableMarkdown(), 'run: node src/tools/refsTable.js and paste the table into the doc');
});
