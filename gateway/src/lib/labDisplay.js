/**
 * Lab values in the user's display units (Settings → units, shared/units.js): results stay in the catalog unit in the
 * database; API answers, exports and the report convert on the way out, ranges typed by the user convert on the way in.
 */
import { labUnits } from '../../../shared/units.js';
import { createFormat } from '../../../shared/format.js';
import { entry } from './canonical.js';
import { getUserLocale } from './userLocale.js';

const catalogUnit = (key) => entry(key)?.unit ?? null;

/** The converter for this user (SI for most, conventional US units when chosen or by region), labels in the user's language. */
export async function userLabUnits(userId) {
  const f = createFormat(await getUserLocale(userId));
  return labUnits(f.labUnits, catalogUnit, f.language);
}

/** A series point ({ valueNum, refLow, refHigh, labRefLow, labRefHigh, delta, unit, … }) in display units. */
export function displayPoint(u, key, p) {
  if (!p || !key) return p;
  const stored = p.unit;
  const v = (x) => u.toDisplay(key, x, stored).value;
  return { ...p, valueNum: v(p.valueNum), refLow: v(p.refLow), refHigh: v(p.refHigh), labRefLow: v(p.labRefLow), labRefHigh: v(p.labRefHigh), delta: u.delta(key, p.delta, stored), unit: u.unit(key, stored) };
}

/** A range { low, high } in display units (null stays null). */
export function displayRange(u, key, r) {
  if (!r) return r;
  return { ...r, low: u.toDisplay(key, r.low, null).value, high: u.toDisplay(key, r.high, null).value };
}
