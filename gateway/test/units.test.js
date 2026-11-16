import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitFamily, toCanonical } from '../src/lib/units.js';

test('unit families: spelling variants collapse', () => {
  assert.equal(unitFamily('Ед/л'), unitFamily('ЕД/л'));
  assert.equal(unitFamily('U/L'), 'u/l');
  assert.equal(unitFamily('*10^9/л'), unitFamily('10^9/л'));
  assert.equal(unitFamily('×10⁹/л'), '10^9/l');
  assert.equal(unitFamily('тыс/мкл'), '10^9/l');
  assert.equal(unitFamily('fL'), unitFamily('фл'));
  assert.equal(unitFamily('сек'), 's');
  assert.equal(unitFamily('мм/час'), unitFamily('мм/ч'));
  assert.equal(unitFamily('10^12/л'), '10^12/l');
  assert.equal(unitFamily('мМоль/л'), 'mmol/l');
  assert.equal(unitFamily('мкМЕ/мл'), unitFamily('мМЕ/л'));
});

test('HGB г/дл → г/л with refs', () => {
  const c = toCanonical('HGB', 16.5, 'г/дл', 13, 16);
  assert.equal(c.status, 'converted');
  assert.equal(c.value, 165);
  assert.deepEqual([c.refLow, c.refHigh], [130, 160]);
  assert.equal(c.unit, 'г/л');
});

test('same unit different spelling: relabel only', () => {
  const c = toCanonical('ALT', 122.2, 'ЕД/л', 0, 50);
  assert.equal(c.status, 'same');
  assert.equal(c.value, 122.2);
  assert.equal(c.unit, 'Ед/л');
});

test('molar conversions per marker', () => {
  assert.equal(toCanonical('GLU', 100, 'mg/dL').value, 5.55);
  assert.equal(toCanonical('CREA', 1, 'мг/дл').value, 88.4);
  assert.equal(toCanonical('BIL', 1, 'mg/dl').value, 17.1);
  assert.equal(toCanonical('PLT', 229000, '/мкл').value, 229);
});

test('incompatible units are left alone', () => {
  const c = toCanonical('PDW', 9.4, 'fL', 10, 20);
  assert.equal(c.status, 'incompatible');
  assert.equal(c.value, 9.4);
  assert.equal(c.unit, 'fL');
});

test('a bound stays a bound: the comparator of a printed result', async () => {
  const { comparatorOf } = await import('../src/lib/units.js');
  assert.equal(comparatorOf('<0,6'), '<');
  assert.equal(comparatorOf(' >= 90'), '>=');
  assert.equal(comparatorOf('≤5'), '≤');
  assert.equal(comparatorOf('0,6'), '');
  assert.equal(comparatorOf(null), '');
});
