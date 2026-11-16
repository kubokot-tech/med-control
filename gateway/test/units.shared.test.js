import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labUnits, bodyUnits, displayUnit, CONVENTIONAL } from '../../shared/units.js';
import { createFormat } from '../../shared/format.js';
import { entry, catalog } from '../src/lib/canonical.js';
import { unitFamily, toCanonical } from '../src/lib/units.js';

const catalogUnit = (k) => entry(k)?.unit ?? null;

test('every conventional unit belongs to a catalog marker with an SI unit', () => {
  for (const k of Object.keys(CONVENTIONAL)) assert.ok(catalogUnit(k), k);
});

test('lab values convert to conventional units only from the catalog unit', () => {
  const us = labUnits('conventional', catalogUnit);
  assert.deepEqual(us.toDisplay('GLU', 5.5, 'ммоль/л'), { value: 99, unit: 'мг/дл' });
  assert.deepEqual(us.toDisplay('CREA', 88.42, 'мкмоль/л'), { value: 1, unit: 'мг/дл' });
  assert.deepEqual(us.toDisplay('HGB', 135, 'г/л'), { value: 13.5, unit: 'г/дл' });
  assert.deepEqual(us.toDisplay('HGB', 13.5, 'г/дл'), { value: 13.5, unit: 'г/дл' }, 'a value left in the lab\'s unit is not converted again');
  assert.deepEqual(us.toDisplay('ALT', 40, 'Ед/л'), { value: 40, unit: 'Ед/л' }, 'no conventional unit: as stored');
  assert.equal(us.unit('WBC', '×10⁹/л'), '×10³/мкл');
  assert.ok(Math.abs(us.fromDisplay('GLU', 99.1) - 5.5) < 0.01);
  assert.equal(us.delta('CHOL', 1, 'ммоль/л'), 39);
  const si = labUnits('si', catalogUnit);
  assert.deepEqual(si.toDisplay('GLU', 5.5, 'ммоль/л'), { value: 5.5, unit: 'ммоль/л' });
  assert.equal(si.fromDisplay('GLU', 5.5), 5.5);
});

test('diary temperature and weight', () => {
  const us = bodyUnits({ temperature: 'f', weight: 'lb' });
  assert.equal(us.temperature(37), 98.6);
  assert.equal(us.temperatureIn(98.6), 37);
  assert.equal(us.weight(70), 154.3);
  assert.equal(us.weightIn(154.3), 69.99);
  assert.deepEqual([us.temperatureUnit, us.weightUnit], ['°F', 'lb']);
  const ru = bodyUnits();
  assert.equal(ru.temperature(36.6), 36.6);
  assert.equal(ru.weightIn(70.5), 70.5);
});

test('units in English: token by token, so a lab\'s own spelling converts too', () => {
  const cases = {
    'Ед/л': 'U/L', 'ЕД/Л': 'U/L', 'МЕ/мл': 'IU/mL', 'мкмоль/л': 'µmol/L', 'ммоль/л': 'mmol/L', '×10⁹/л': '×10⁹/L', '×10¹²/л': '×10¹²/L', '×10³/мкл': '×10³/µL',
    'х10^9/л': '×10^9/L', '10*9/л': '10*9/L', '10^9 кл/л': '10^9 cells/L', 'мМЕ/л': 'mIU/L', 'мЕд/л': 'mU/L', 'мкМЕ/мл': 'µIU/mL', 'мг/дл': 'mg/dL', 'г/л': 'g/L', 'г/дл': 'g/dL',
    'мм/ч': 'mm/h', 'фл': 'fL', 'пг': 'pg', 'с': 's', 'сек': 's', 'мг': 'mg', 'мкг': 'mcg', 'мкг/л': 'mcg/L', 'нг/мл': 'ng/mL', 'мл': 'mL', 'кг': 'kg', 'г': 'g',
    'Ед/г Hb': 'U/g Hb', 'тыс/мкл': 'thou/µL', 'млн/мкл': 'mil/µL', 'мм рт. ст.': 'mmHg', 'мл/мин': 'mL/min', 'г/сут': 'g/day', 'кл/мкл': 'cells/µL', 'в п/зр': '/HPF', '%': '%', 'U/L': 'U/L',
  };
  for (const [ru, en] of Object.entries(cases)) assert.equal(displayUnit(ru, 'en'), en, ru);
});

test('Russian, an empty unit and an unknown word stay exactly as they are', () => {
  for (const u of ['Ед/л', 'мкмоль/л', '×10⁹/л', 'ЕД/Л']) assert.equal(displayUnit(u, 'ru'), u);
  assert.equal(displayUnit('Ед/л'), 'Ед/л', 'Russian by default');
  assert.equal(displayUnit(null, 'en'), null);
  assert.equal(displayUnit('', 'en'), '');
  assert.equal(displayUnit('ложки/л', 'en'), 'ложки/л', 'never half translated');
});

test('every catalog and conventional unit has an English spelling, and it reads as the same unit', () => {
  const units = [...catalog().map((c) => c.unit), ...Object.values(CONVENTIONAL).map((c) => c.unit)].filter(Boolean);
  for (const u of new Set(units)) {
    assert.doesNotMatch(displayUnit(u, 'en'), /[А-Яа-яЁё]/, u);
    assert.equal(unitFamily(displayUnit(u, 'en')), unitFamily(u), u);
  }
  for (const c of catalog()) if (c.unit) assert.equal(toCanonical(c.key, 5, displayUnit(c.unit, 'en')).status, 'same', c.key);
});

test('labels follow the language, the comparison with the stored unit does not', () => {
  const u = labUnits('conventional', catalogUnit, 'en');
  assert.deepEqual(u.toDisplay('GLU', 5.5, 'ммоль/л'), { value: 99, unit: 'mg/dL' }, 'the stored Russian unit still counts as the catalog one');
  assert.deepEqual(u.toDisplay('ALT', 40, 'Ед/л'), { value: 40, unit: 'U/L' });
  assert.deepEqual(u.toDisplay('HGB', 13.5, 'г/дл'), { value: 13.5, unit: 'g/dL' }, 'a value in the lab\'s unit is not converted, only labeled');
  assert.equal(u.unit('WBC', '×10⁹/л'), '×10³/µL');
  assert.equal(labUnits('si', catalogUnit, 'en').unit('ALT', 'Ед/л'), 'U/L');
  assert.equal(bodyUnits({ language: 'en' }).weightUnit, 'kg');
  assert.equal(bodyUnits().weightUnit, 'кг');
  assert.equal(createFormat({ language: 'en' }).unit('мг'), 'mg');
  assert.equal(createFormat({ language: 'ru' }).unit('мг'), 'мг');
});
