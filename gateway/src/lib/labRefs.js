/**
 * Reference ranges the user controls (docs/REFERENCE-RANGES.md): the patient's sex for sex-specific built-in ranges, and
 * per marker either an own range or «as printed by the lab». The range in force for each result is resolved in SQL
 * (view lab_results_eff); this module only reads and writes the inputs.
 */
import { pool } from './db.js';
import { catalog, entry } from './canonical.js';
import { referenceRange, builtInRange } from './referenceRanges.js';
import { invalid, notFound } from './errors.js';

export const SEXES = ['m', 'f'];

const num = (v) => (v == null ? null : Number(v));

/** { sex, items: [{ key, name, short, unit, category, builtIn: { any, m, f } | null, inForce: { low, high, source }, override }] } */
export async function getRefSettings(userId) {
  const [u, o] = await Promise.all([
    pool.query('select sex from users where id = $1', [userId]),
    pool.query('select key, mode, ref_low, ref_high, updated_at from lab_ref_overrides where user_id = $1', [userId]),
  ]);
  const sex = u.rows[0]?.sex ?? null;
  const overrides = new Map(o.rows.map((x) => [x.key, { mode: x.mode, low: num(x.ref_low), high: num(x.ref_high), updatedAt: x.updated_at }]));
  const items = catalog().map((c) => {
    const override = overrides.get(c.key) || null;
    const built = builtInRange(c.key, sex);
    // What lab_results_eff will use for results in the catalog unit (the lab's own range is per result, shown as 'lab').
    const inForce = override?.mode === 'custom' ? { low: override.low, high: override.high, source: 'user' }
      : override?.mode === 'lab' || !built ? { low: null, high: null, source: 'lab' }
        : { low: built.low, high: built.high, source: 'catalog' };
    return { key: c.key, name: c.name, short: c.short ?? null, unit: c.unit ?? null, category: c.category, builtIn: referenceRange(c.key), inForce, override };
  });
  return { sex, items };
}

/** Sex for the built-in ranges: 'm', 'f' or null (not given). */
export async function setSex(userId, sex) {
  if (sex !== null && !SEXES.includes(sex)) throw invalid('invalid_body');
  await pool.query('update users set sex = $2 where id = $1', [userId, sex]);
  return sex;
}

/** Own range for a marker in its catalog unit: { mode: 'custom', low, high } (one side may be null) or { mode: 'lab' }. */
export async function setOverride(userId, key, { mode = 'custom', low = null, high = null } = {}) {
  if (!entry(key)) throw notFound('unknown_key');
  if (mode !== 'custom' && mode !== 'lab') throw invalid('invalid_body');
  const lo = low === '' || low == null ? null : Number(low);
  const hi = high === '' || high == null ? null : Number(high);
  if (mode === 'custom') {
    if ((lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi))) throw invalid('bad_ref_range');
    if (lo == null && hi == null) throw invalid('bad_ref_range');
    if (lo != null && hi != null && lo > hi) throw invalid('bad_ref_range');
  }
  await pool.query(
    `insert into lab_ref_overrides (user_id, key, mode, ref_low, ref_high, updated_at) values ($1,$2,$3,$4,$5, now())
     on conflict (user_id, key) do update set mode = excluded.mode, ref_low = excluded.ref_low, ref_high = excluded.ref_high, updated_at = now()`,
    [userId, key, mode, mode === 'custom' ? lo : null, mode === 'custom' ? hi : null]
  );
  return { mode, low: mode === 'custom' ? lo : null, high: mode === 'custom' ? hi : null };
}

/** Back to the default (built-in range, or the lab's when there is none). */
export async function clearOverride(userId, key) {
  await pool.query('delete from lab_ref_overrides where user_id = $1 and key = $2', [userId, key]);
}
