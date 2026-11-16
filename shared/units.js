/**
 * Display units chosen in Settings → «Язык, регион, часовой пояс» (docs/I18N.md). Data is stored in SI (lab results in
 * the catalog unit, temperature in °C, weight in kg); these convert only for showing and for typed input.
 * Shared by the gateway (lab values in API answers, exports) and the frontend (diary temperature and weight).
 */

export const LAB_UNIT_SYSTEMS = ['si', 'conventional'];
export const TEMPERATURE_UNITS = ['c', 'f'];
export const WEIGHT_UNITS = ['kg', 'lb'];

/**
 * Conventional (US) units for markers whose catalog unit is SI: unit label, factor SI → conventional, decimals to keep.
 * The SI unit is the catalog's (gateway/src/lib/catalogSeed.js); markers not listed are shown as stored.
 */
export const CONVENTIONAL = {
  GLU: { unit: 'мг/дл', factor: 18.016, digits: 0 },
  eAG: { unit: 'мг/дл', factor: 18.016, digits: 0 },
  'U-GLU': { unit: 'мг/дл', factor: 18.016, digits: 0 },
  CREA: { unit: 'мг/дл', factor: 1 / 88.42, digits: 2 },
  BIL: { unit: 'мг/дл', factor: 1 / 17.1, digits: 1 },
  CHOL: { unit: 'мг/дл', factor: 38.67, digits: 0 },
  HDL: { unit: 'мг/дл', factor: 38.67, digits: 0 },
  LDL: { unit: 'мг/дл', factor: 38.67, digits: 0 },
  VLDL: { unit: 'мг/дл', factor: 38.67, digits: 0 },
  NONHDL: { unit: 'мг/дл', factor: 38.67, digits: 0 },
  TG: { unit: 'мг/дл', factor: 88.57, digits: 0 },
  CA: { unit: 'мг/дл', factor: 4.008, digits: 1 },
  MG: { unit: 'мг/дл', factor: 2.431, digits: 1 },
  HGB: { unit: 'г/дл', factor: 0.1, digits: 1 },
  MCHC: { unit: 'г/дл', factor: 0.1, digits: 1 },
  PROT: { unit: 'г/дл', factor: 0.1, digits: 1 },
  FIB: { unit: 'мг/дл', factor: 100, digits: 0 },
  TRF: { unit: 'мг/дл', factor: 100, digits: 0 },
  FE: { unit: 'мкг/дл', factor: 5.585, digits: 0 },
  TIBC: { unit: 'мкг/дл', factor: 5.585, digits: 0 },
  UIBC: { unit: 'мкг/дл', factor: 5.585, digits: 0 },
  ZN: { unit: 'мкг/дл', factor: 6.54, digits: 0 },
  FERR: { unit: 'нг/мл', factor: 1, digits: 1 },
  WBC: { unit: '×10³/мкл', factor: 1, digits: 2 },
  'NEUT#': { unit: '×10³/мкл', factor: 1, digits: 2 },
  'LYM#': { unit: '×10³/мкл', factor: 1, digits: 2 },
  'MONO#': { unit: '×10³/мкл', factor: 1, digits: 2 },
  'EO#': { unit: '×10³/мкл', factor: 1, digits: 2 },
  'BASO#': { unit: '×10³/мкл', factor: 1, digits: 2 },
  PLT: { unit: '×10³/мкл', factor: 1, digits: 0 },
  RBC: { unit: '×10⁶/мкл', factor: 1, digits: 2 },
};

// Cyrillic unit tokens → English, lower case; a capital («Ед/Л», «ММОЛЬ/л») reads the same.
const UNIT_TOKENS = {
  ед: 'U', ме: 'IU', мед: 'mU', мме: 'mIU', мкед: 'µU', мкме: 'µIU', кед: 'kU', кме: 'kIU',
  моль: 'mol', ммоль: 'mmol', мкмоль: 'µmol', нмоль: 'nmol', пмоль: 'pmol', мосм: 'mOsm', мэкв: 'mEq',
  г: 'g', кг: 'kg', мг: 'mg', мкг: 'mcg', нг: 'ng', пг: 'pg',
  л: 'L', дл: 'dL', мл: 'mL', мкл: 'µL', фл: 'fL', пл: 'pL',
  с: 's', сек: 's', мин: 'min', ч: 'h', час: 'h', сут: 'day', сутки: 'day',
  м: 'm', см: 'cm', мм: 'mm', мкм: 'µm', ккал: 'kcal',
  кл: 'cells', клетки: 'cells', клеток: 'cells', тыс: 'thou', млн: 'mil', млрд: 'bil', шт: 'pcs',
  х: '×', // a Cyrillic letter typed for the multiplication sign: «х10^9/л»
};
// Whole phrases, before the tokens.
const UNIT_PHRASES = [[/мм\s*рт\.?\s*ст\.?/gi, 'mmHg'], [/(?:в\s*)?(?:поле\s+зрения|п\/зр?\.?)/gi, '/HPF'], [/(?:отн|усл)\.?\s*ед\.?/gi, 'arb. units']];
const CYRILLIC = /[А-Яа-яЁё]/;

/**
 * A unit as the language writes it: 'Ед/л' → 'U/L', '×10⁹/л' → '×10⁹/L'. Token by token, so a lab's own spelling converts
 * too; a unit with an unknown word stays whole rather than half translated. For showing only: stored units and every
 * comparison with them stay as they are. Russian and units with no Cyrillic come back untouched.
 */
export function displayUnit(unit, language = 'ru') {
  if (language === 'ru' || !unit || !CYRILLIC.test(unit)) return unit ?? null;
  let out = String(unit);
  for (const [rx, to] of UNIT_PHRASES) out = out.replace(rx, to);
  let unknown = false;
  out = out.replace(/([А-Яа-яЁё]+)\.?/g, (_, word) => {
    const to = UNIT_TOKENS[word.toLowerCase().replace(/ё/g, 'е')];
    if (!to) unknown = true;
    return to ?? word;
  });
  return unknown ? unit : out;
}

const round = (v, digits) => { const k = 10 ** digits; return Math.round(v * k) / k; };

/**
 * Lab value converter for a unit system. `catalogUnit(key)` gives the SI unit a stored value is in; a value stored in
 * another unit (the lab's own, not convertible) is left as it is.
 *   toDisplay(key, value, storedUnit) → { value, unit }
 *   fromDisplay(key, value) → SI value (for ranges typed by the user)
 *   unit(key, storedUnit) → the label shown
 * Unit labels come out in `language` (displayUnit); `storedUnit` is always the stored spelling.
 */
export function labUnits(system, catalogUnit, language = 'ru') {
  const show = (u) => displayUnit(u, language);
  const conv = (key, storedUnit) => {
    if (system !== 'conventional') return null;
    const c = CONVENTIONAL[key];
    if (!c) return null;
    const si = catalogUnit(key);
    return si && (storedUnit == null || storedUnit === si) ? c : null;
  };
  return {
    system,
    language,
    unit: (key, storedUnit) => show(conv(key, storedUnit)?.unit ?? storedUnit ?? catalogUnit(key) ?? null),
    toDisplay(key, value, storedUnit) {
      const c = conv(key, storedUnit);
      if (value == null || value === '' || !c) return { value: value == null || value === '' ? null : Number(value), unit: show(storedUnit) };
      return { value: round(Number(value) * c.factor, c.digits), unit: show(c.unit) };
    },
    fromDisplay(key, value) {
      const c = conv(key, null);
      if (value == null || value === '') return null;
      return c ? Number(value) / c.factor : Number(value);
    },
    /** Change between two values (a delta) in display units. */
    delta(key, d, storedUnit) {
      const c = conv(key, storedUnit);
      return d == null ? null : c ? round(d * c.factor, c.digits) : d;
    },
  };
}

const KG_PER_LB = 0.45359237;

/** Diary temperature and weight: display ↔ stored (°C, kg). */
export function bodyUnits({ temperature = 'c', weight = 'kg', language = 'ru' } = {}) {
  const f = temperature === 'f'; const lb = weight === 'lb';
  return {
    temperatureUnit: f ? '°F' : '°C',
    weightUnit: lb ? 'lb' : displayUnit('кг', language),
    temperature: (c) => (c == null ? null : f ? Math.round((c * 9 / 5 + 32) * 10) / 10 : c),
    temperatureIn: (v) => (v == null ? null : f ? Math.round(((v - 32) * 5 / 9) * 100) / 100 : v),
    weight: (kg) => (kg == null ? null : lb ? Math.round((kg / KG_PER_LB) * 10) / 10 : kg),
    weightIn: (v) => (v == null ? null : lb ? Math.round(v * KG_PER_LB * 100) / 100 : v),
  };
}
