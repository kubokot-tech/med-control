import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitFamily } from '../src/lib/units.js';

// testCode lives in labsCommit (needs a DB); its rule is mirrored here through a dynamic import guard
process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x';
const { testCode, shouldSkipObs } = await import('../src/lib/labsCommit.js');

test('unit families: 10*N and friends', () => {
  assert.equal(unitFamily('10*9/л'), '10^9/l');
  assert.equal(unitFamily('10*12/л'), '10^12/l');
  assert.equal(unitFamily('тыс/мкл'), '10^9/l');
  assert.equal(unitFamily('млн/мкл'), '10^12/l');
});

test('blood counts stay blood, urine microscopy becomes «(моча)»', () => {
  const t = (name, unit) => testCode({ test_name_raw: name, unit_raw: unit });
  assert.equal(t('Эритроциты', 'млн/мкл'), 'Эритроциты');
  assert.equal(t('Лейкоциты', '10*3/мкл'), 'Лейкоциты');
  assert.equal(t('Лейкоциты', '10³/мкл'), 'Лейкоциты');
  assert.equal(t('Лейкоциты', 'тыс/мкл'), 'Лейкоциты');
  assert.equal(t('Лейкоциты', '10^9/л'), 'Лейкоциты');
  assert.equal(t('Лейкоциты', 'количество/мкл'), 'Лейкоциты (моча)');
  assert.equal(t('Эритроциты', 'кл/мкл'), 'Эритроциты (моча)');
  assert.equal(t('Лейкоциты', 'клет/мкл'), 'Лейкоциты (моча)');
  assert.equal(t('Лейкоциты', 'в п/з'), 'Лейкоциты (моча)');
  assert.equal(t('Лейкоциты в моче', 'кл/мкл'), 'Лейкоциты в моче');
});

test('the «(моча)» mark of a urine section does not keep descriptive rows from being skipped', () => {
  const skip = (name, result_text, result_num = null) => shouldSkipObs({ test_name_raw: name, result_text, result_num });
  assert.equal(skip('Слизь (моча)', '0,4', 0.4), true);
  assert.equal(skip('Цвет (моча)', 'зеленый'), true);
  assert.equal(skip('Лейкоциты (моча)', '3,60', 3.6), false);
  assert.equal(skip('Относительная плотность (моча)', '1,026', 1.026), false);
});

test('tacrolimus level maps to TAC in any common spelling, ng/mL and µg/L are one family', async () => {
  const { classify } = await import('../src/lib/canonical.js');
  for (const name of ['Такролимус', 'Такролимус (концентрация в крови)', 'Tacrolimus', 'FK-506', 'Програф, остаточная концентрация']) {
    assert.equal(classify(name).key, 'TAC', name);
  }
  assert.notEqual(classify('Креатинин').key, 'TAC');
  assert.equal(unitFamily('нг/мл'), unitFamily('ng/mL'));
});
