/**
 * Lab marker canonicalization: raw test names from any lab → catalog keys (ALT, HGB, NEUT#…).
 * The catalog seed lives in catalogSeed.js; loadCatalog() upserts it into lab_catalog and
 * compiles the in-memory index used by canonicalKeyFor()/categoryFor().
 */
import { CATALOG_SEED } from './catalogSeed.js';
import { referenceRange } from './referenceRanges.js';
import { DEFAULT_LANGUAGE } from '../../../shared/format.js';
import { has, raw } from './i18n.js';

// Names that describe a urine test. `моч(?!евин)` keeps "мочевина" (urea, blood) out.
const URINE_RX = /моч(?!евин)|урин|(^|[^а-я])оам([^а-я]|$)|осадок|удельн|нитрит|кетон|уробилин|полуколич|качественно|(^|[^a-z])ph([^a-z]|$)|^цвет$|^прозрачн|^запах$|^реакция/;

let entries = [];
let byKey = new Map();

export function normalize(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function compile(seed) {
  entries = seed
    .map((e) => ({
      ...e,
      aliases: e.aliases ?? [],
      isKey: Boolean(e.isKey),
      aliasSet: new Set((e.aliases ?? []).map(normalize)),
      rx: e.pattern ? new RegExp(e.pattern) : null,
      excludeRx: e.exclude ? new RegExp(e.exclude) : null,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  byKey = new Map(entries.map((e) => [e.key, e]));
}

compile(CATALOG_SEED);

export function looksLikeUrine(raw) {
  return URINE_RX.test(normalize(raw));
}

/** Catalog key for a raw test name, or null. */
export function canonicalKeyFor(raw) {
  const n = normalize(raw);
  if (!n) return null;
  const urine = URINE_RX.test(n);
  for (const e of entries) {
    if (e.aliasSet.has(n)) return e.key;
  }
  for (const e of entries) {
    if (!e.rx || !e.rx.test(n)) continue;
    if (e.excludeRx && e.excludeRx.test(n)) continue;
    if (e.category === 'blood' && urine) continue;
    if (e.category === 'urine' && !urine) continue;
    return e.key;
  }
  return null;
}

/** 'blood' | 'urine' for a raw test name (catalog entry wins, then the urine heuristic). */
export function categoryFor(raw) {
  const key = canonicalKeyFor(raw);
  if (key) return byKey.get(key).category;
  return looksLikeUrine(raw) ? 'urine' : 'blood';
}

export function classify(raw) {
  const key = canonicalKeyFor(raw);
  return { key, category: key ? byKey.get(key).category : (looksLikeUrine(raw) ? 'urine' : 'blood') };
}

export function entry(key) {
  return byKey.get(key) ?? null;
}

/** Full name of a catalog marker in `language`; the catalog's own Russian name is the source of the dictionary. */
export function markerName(key, language = DEFAULT_LANGUAGE) {
  const e = byKey.get(key);
  if (!e) return key;
  return language !== DEFAULT_LANGUAGE && has(language, `markers.${key}.name`) ? raw(language, `markers.${key}.name`) : e.name;
}

/** Short name of a catalog marker in `language`. */
export function markerShort(key, language = DEFAULT_LANGUAGE) {
  const e = byKey.get(key);
  if (!e) return key;
  return language !== DEFAULT_LANGUAGE && has(language, `markers.${key}.short`) ? raw(language, `markers.${key}.short`) : e.short ?? e.key;
}

/** Public shape of the catalog (sorted by sortOrder), names in `language`. */
export function catalog(language = DEFAULT_LANGUAGE) {
  return entries.map((e) => ({
    key: e.key,
    name: markerName(e.key, language),
    short: markerShort(e.key, language),
    category: e.category,
    unit: e.unit ?? null,
    sortOrder: e.sortOrder,
    isKey: e.isKey,
  }));
}

export function keyKeys() {
  return entries.filter((e) => e.isKey).map((e) => e.key);
}

export function displayName(keyOrCode) {
  return byKey.get(keyOrCode)?.name ?? keyOrCode;
}

/** Upsert the seed and the built-in reference ranges into lab_catalog so SQL (lab_results_eff) and the frontend read the same catalog. */
export async function loadCatalog(pool) {
  for (const e of entries) {
    const r = referenceRange(e.key);
    const lo = (x) => x?.low ?? null; const hi = (x) => x?.high ?? null;
    await pool.query(
      `insert into lab_catalog (key, name_ru, short_ru, category, unit_canonical, aliases, pattern, sort_order, is_key,
                                ref_low_default, ref_high_default, ref_low_m, ref_high_m, ref_low_f, ref_high_f, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       on conflict (key) do update set
         name_ru = excluded.name_ru, short_ru = excluded.short_ru, category = excluded.category,
         unit_canonical = excluded.unit_canonical, aliases = excluded.aliases, pattern = excluded.pattern,
         sort_order = excluded.sort_order, is_key = excluded.is_key,
         ref_low_default = excluded.ref_low_default, ref_high_default = excluded.ref_high_default,
         ref_low_m = excluded.ref_low_m, ref_high_m = excluded.ref_high_m, ref_low_f = excluded.ref_low_f, ref_high_f = excluded.ref_high_f,
         updated_at = now()`,
      [e.key, e.name, e.short ?? null, e.category, e.unit ?? null, e.aliases, e.pattern ?? null, e.sortOrder, e.isKey,
        lo(r?.any), hi(r?.any), lo(r?.m), hi(r?.m), lo(r?.f), hi(r?.f)]
    );
  }
  return entries.length;
}

/** Recompute canonical_key/category for every lab_tests row; update only rows that differ. */
export async function recanonicalize(pool, log = console) {
  const r = await pool.query('select id, code, canonical_key, category from lab_tests');
  const changes = [];
  for (const row of r.rows) {
    const { key, category } = classify(row.code);
    if (key !== row.canonical_key || category !== row.category) {
      await pool.query('update lab_tests set canonical_key = $2, category = $3 where id = $1', [row.id, key, category]);
      changes.push({ code: row.code, from: `${row.canonical_key ?? '-'}/${row.category}`, to: `${key ?? '-'}/${category}` });
    }
  }
  log.info(`catalog: ${entries.length} entries, recanonicalized ${changes.length} of ${r.rows.length} lab_tests`);
  for (const c of changes.slice(0, 40)) log.info(`  ${c.code}: ${c.from} → ${c.to}`);
  return changes;
}
