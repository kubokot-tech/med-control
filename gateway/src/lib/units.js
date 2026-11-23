/**
 * Units between laboratories. Every marker in the catalog has a canonical unit; values are
 * converted to it on write (labsCommit) and once for old rows (renormalizeUnits at start).
 * Spelling variants of one unit (ЕД/л, Ед/л, U/L) map to the same family; real conversions
 * (г/дл → г/л, мг/дл → мкмоль/л) use molar factors per marker; incompatible pairs (PDW % vs fL)
 * are left as they are and reported.
 */
import { entry } from './canonical.js';

/** Unit family: a normalized token so that spelling variants compare equal. */
export function unitFamily(unit) {
  let u = String(unit || '').toLowerCase().replace(/\s+/g, '');
  if (!u) return '';
  // 10*9 / 10x9 / 10×9 → 10^9 first, only then drop multiplication signs (otherwise «10*9/л» became «109/l»)
  u = u.replace(/10[*x×·]\s*(\d+)/g, '10^$1');
  u = u.replace(/[×x*·]/g, '').replace(/10⁹/g, '10^9').replace(/10¹²/g, '10^12').replace(/10³/g, '10^3').replace(/10\*(\d)/g, '10^$1');
  u = u.replace(/тыс\.?\/мкл|thou\/ul|k\/ul|10\^3\/(мкл|ul|µl)/, '10^9/l').replace(/млн\.?\/мкл|m\/ul|10\^6\/(мкл|ul|µl)/, '10^12/l');
  u = u.replace(/\/л$|\/l$/, '/l').replace(/\/мл$|\/ml$/, '/ml').replace(/\/дл$|\/dl$/, '/dl').replace(/\/мкл$|\/ul$|\/µl$/, '/ul');
  const map = [
    [/^(ед|ед\.|u|iu|ме|е)\/l$/, 'u/l'], [/^(ед|u)\/(г|g)hb$/, 'u/ghb'], [/^(мед|mu|mme|мЕд)\/l$/, 'miu/l'],
    [/^(мкмоль|umol|µmol)\/l$/, 'umol/l'], [/^(ммоль|mmol)\/l$/, 'mmol/l'], [/^(нмоль|nmol)\/l$/, 'nmol/l'], [/^(пмоль|pmol)\/l$/, 'pmol/l'],
    [/^(мг|mg)\/dl$/, 'mg/dl'], [/^(мг|mg)\/l$/, 'mg/l'], [/^(г|g)\/dl$/, 'g/dl'], [/^(г|g)\/l$/, 'g/l'], [/^(г|g)%$/, 'g/dl'],
    [/^(мкг|ug|µg|mcg)\/dl$/, 'ug/dl'], [/^(мкг|ug|µg|mcg)\/l$/, 'ug/l'], [/^(нг|ng)\/ml$/, 'ng/ml'], [/^(нг|ng)\/dl$/, 'ng/dl'], [/^(пг|pg)\/ml$/, 'pg/ml'],
    [/^(мкме|мкед|uiu|µiu|мкме)\/ml$/, 'miu/l'], [/^(мме|mme|miu|mu)\/l$/, 'miu/l'],
    [/^10\^9\/l$/, '10^9/l'], [/^10\^12\/l$/, '10^12/l'], [/^(кл|клеток|cells)?\/ul$/, '/ul'],
    [/^(фл|fl)$/, 'fl'], [/^(пг|pg)$/, 'pg'], [/^%$/, '%'], [/^(с|сек|sec|s)$/, 's'], [/^(мм\/ч(ас)?|mm\/h)$/, 'mm/h'],
  ];
  for (const [rx, fam] of map) if (rx.test(u)) return fam;
  return u;
}

// Factors from -> to, generic (mass/volume) or per marker (molar mass).
const GENERIC = { 'g/dl->g/l': 10, 'g/l->g/dl': 0.1, '/ul->10^9/l': 0.001, '10^9/l->/ul': 1000, 'mg/l->ug/l': 1000, 'ug/l->mg/l': 0.001, 'ng/ml->ug/l': 1, 'ug/l->ng/ml': 1, 'miu/l->miu/l': 1 };
const MOLAR = { // mg/dL -> mmol/L (or µmol/L where the catalog says so)
  GLU: 0.0555, eAG: 0.0555, 'U-GLU': 0.0555, UREA: 0.1665, CHOL: 0.02586, HDL: 0.02586, LDL: 0.02586, VLDL: 0.02586, NONHDL: 0.02586, TG: 0.01129,
  CA: 0.2495, MG: 0.4114, CREA: 88.4, BIL: 17.1, 'BIL-D': 17.1, FE: 0.179, ZN: 0.153, TIBC: 0.179, UIBC: 0.179,
};
const MASS_FROM = { FE: 'ug/dl', ZN: 'ug/dl', TIBC: 'ug/dl', UIBC: 'ug/dl' };

function factor(key, from, to) {
  if (from === to) return 1;
  if (GENERIC[`${from}->${to}`] != null) return GENERIC[`${from}->${to}`];
  const molarFrom = MASS_FROM[key] || 'mg/dl';
  if (MOLAR[key] != null && from === molarFrom && (to === 'mmol/l' || to === 'umol/l')) return MOLAR[key];
  if (MOLAR[key] != null && to === molarFrom && (from === 'mmol/l' || from === 'umol/l')) return 1 / MOLAR[key];
  return null;
}

/**
 * Convert a value (and refs) to the catalog unit of the marker.
 * Returns { value, refLow, refHigh, unit, factor, status } where status is
 * 'same' (unit already canonical, spelling may differ), 'converted', 'incompatible' (left as is) or 'unknown' (no catalog unit).
 */
/** A unit string that is not a unit at all (parser picked a column label): drop it rather than store garbage. */
export function cleanUnit(u) {
  const s = String(u ?? '').trim();
  if (!s) return null;
  if (s.length > 16 || /[:;]/.test(s) || /исполнител|нормализован|результат|референс|норма/i.test(s)) return null;
  return s;
}

export function toCanonical(key, value, unit, refLow = null, refHigh = null) {
  const target = entry(key)?.unit || '';
  const asIs = { value, refLow, refHigh, unit: unit || '', factor: 1, status: 'unknown' };
  if (!target) return asIs;
  const from = unitFamily(unit), to = unitFamily(target);
  if (!from) return { ...asIs, unit: '', status: 'unknown' }; // no unit in the document: never guess
  const f = factor(key, from, to);
  if (f == null) return { ...asIs, status: 'incompatible' };
  const conv = (x) => (x == null ? null : Math.round(Number(x) * f * 1000) / 1000);
  return { value: conv(value), refLow: conv(refLow), refHigh: conv(refHigh), unit: target, factor: f, status: f === 1 ? 'same' : 'converted' };
}

/** «<», «>», «≤», «≥» (and «<=», «>=») at the start of a result as printed («<0,6»), or ''. */
export const comparatorOf = (text) => /^\s*([<>≤≥]=?)/.exec(String(text ?? ''))?.[1] || '';

/** Numeric text in the app's format (comma decimal), for value_text after a conversion. */
export function formatValueText(v) {
  return v == null ? null : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3, useGrouping: false }).format(v);
}

/** One-off pass over stored results: convert values written before unit normalization existed. Idempotent. */
export async function renormalizeUnits(pool, log = console) {
  const r = await pool.query(
    `select r.id, t.canonical_key as key, r.value_numeric, r.unit_original, r.unit_canonical, r.ref_low, r.ref_high
       from lab_results r join lab_tests t on t.id = r.test_id where t.canonical_key is not null`
  );
  let converted = 0, relabeled = 0, incompatible = 0;
  for (const row of r.rows) {
    const target = entry(row.key)?.unit;
    if (!target || row.unit_canonical === target) continue; // already canonical
    const c = toCanonical(row.key, row.value_numeric != null ? Number(row.value_numeric) : null, row.unit_original, row.ref_low, row.ref_high);
    if (c.status === 'converted') {
      await pool.query('update lab_results set value_numeric=$2, ref_low=$3, ref_high=$4, unit_canonical=$5, value_text = case when value_text ~ $6 then $7 else value_text end where id=$1',
        [row.id, c.value, c.refLow, c.refHigh, c.unit, '^\\s*[<>]?\\s*[0-9]+([.,][0-9]+)?\\s*$', formatValueText(c.value)]);
      converted++;
    } else if (c.status === 'same') {
      await pool.query('update lab_results set unit_canonical=$2 where id=$1', [row.id, c.unit]);
      relabeled++;
    } else if (c.status === 'incompatible') incompatible++;
  }
  // Rows converted before value_text was kept in sync: numeric text that no longer matches the number.
  const fixed = await pool.query(
    `update lab_results set value_text = replace(rtrim(rtrim(round(value_numeric::numeric, 3)::text, '0'), '.'), '.', ',')
      where unit_original is distinct from unit_canonical and value_numeric is not null
        and value_text ~ '^\\s*[0-9]+([.,][0-9]+)?\\s*$' and replace(value_text, ',', '.')::numeric <> value_numeric`
  );
  log.info(`units: converted ${converted}, relabeled ${relabeled}, incompatible left ${incompatible} of ${r.rows.length} results; value_text repaired ${fixed.rowCount}`);
  return { converted, relabeled, incompatible };
}
