/** Monthly labs summary (pivot) shared by the API, Excel and PDF exports. */
import { pool } from './db.js';
import { entry as catalogEntry, markerName, markerShort } from './canonical.js';
import { buildLabsWhere, sliceMonthsByRange, monthPickOrder, DOCUMENT_ID_SUBQUERY } from './labsQuery.js';
import { userLabUnits } from './labDisplay.js';
import { displayUnit } from '../../../shared/units.js';

/** q = readLabsQuery(req) → { months, rows: [{ test, name, short, sortOrder, isCanonical, unit, refLow, refHigh, category, cells }], labs, pick } */
export async function buildSummary(q) {
    const { where, params } = buildLabsWhere(q);

  const sql = `
    with preferred_refs as (
      select distinct on (coalesce(t.canonical_key, t.code))
        coalesce(t.canonical_key, t.code) as test_key,
        r.ref_low as pref_ref_low,
        r.ref_high as pref_ref_high,
        r.unit_canonical as pref_unit,
        r.ref_source as pref_source
      from lab_results_eff r
      join lab_tests t on t.id = r.test_id
      left join events e on e.id = r.source_event_id
      where ${where}
        and (r.ref_low is not null or r.ref_high is not null)
      order by
        coalesce(t.canonical_key, t.code),
        (case r.ref_source when 'user' then 2 when 'catalog' then 1 else 0 end) desc,
        (case when coalesce(e.source,'') = 'ingestion:mknc_pdf_v1' then 1 else 0 end) desc,
        r.collected_at desc
    ),
    last_in_month as (
      select distinct on (coalesce(t.canonical_key, t.code), date_trunc('month', r.collected_at))
        coalesce(t.canonical_key, t.code) as test_key,
        t.name as test_name,
        t.category,
        date_trunc('month', r.collected_at) as month,
        r.collected_at,
        r.value_numeric,
        r.value_text,
        r.unit_canonical,
        r.ref_low,
        r.ref_high,
        r.ref_source,
        r.lab_name,
        r.source_event_id,
        ${DOCUMENT_ID_SUBQUERY} as document_id,
        count(*) over (partition by coalesce(t.canonical_key, t.code), date_trunc('month', r.collected_at)) as n
      from lab_results_eff r
      join lab_tests t on t.id = r.test_id
      where ${where}
      order by coalesce(t.canonical_key, t.code), date_trunc('month', r.collected_at), ${monthPickOrder(q.pick)}
    )
    select
      l.test_key as test,
      l.test_name as test_name,
      l.category,
      to_char(l.month, 'YYYY-MM') as ym,
      l.collected_at,
      l.value_numeric,
      l.value_text,
      coalesce(p.pref_unit, l.unit_canonical) as unit_canonical,
      coalesce(p.pref_ref_low, l.ref_low) as ref_low,
      coalesce(p.pref_ref_high, l.ref_high) as ref_high,
      coalesce(p.pref_source, l.ref_source) as ref_source,
      l.source_event_id,
      l.document_id,
      l.n
    from last_in_month l
    left join preferred_refs p on p.test_key = l.test_key
    order by l.test_key asc, ym asc;
  `;

  const r = await pool.query(sql, params);
  // values in the user's display units (SI unless chosen otherwise); only catalog markers in their catalog unit convert
  const u = q.userId ? await userLabUnits(q.userId) : null;
  const show = (key, v, unit) => (u && v != null ? u.toDisplay(key, v, unit).value : v);

  const months = sliceMonthsByRange(Array.from(new Set(r.rows.map((x) => x.ym))).sort(), q.range);

  const byTest = new Map();
  for (const row of r.rows) {
    const key = row.test;
    if (!byTest.has(key)) {
      const ce = catalogEntry(key);
      byTest.set(key, {
        test: row.test,
        name: ce ? markerName(key, u?.language) : row.test_name,
        short: ce ? markerShort(key, u?.language) : null,
        sortOrder: ce ? ce.sortOrder : 1000,
        category: ce ? ce.category : (row.category || 'blood'),
        isCanonical: Boolean(ce),
        unit: (u && ce ? u.unit(key, row.unit_canonical) : displayUnit(row.unit_canonical, u?.language)) || null,
        refLow: row.ref_low != null ? show(key, Number(row.ref_low), row.unit_canonical) : null,
        refHigh: row.ref_high != null ? show(key, Number(row.ref_high), row.unit_canonical) : null,
        refSource: row.ref_source ?? null,
        cells: {},
      });
    }
    const v = row.value_numeric != null ? Number(row.value_numeric) : null;
    byTest.get(key).cells[row.ym] = {
      valueNum: v != null && catalogEntry(key) ? show(key, v, row.unit_canonical) : v,
      valueText: row.value_text ?? (v !== null ? String(v) : null),
      collectedAt: row.collected_at,
      documentId: row.document_id || null,
      n: Number(row.n || 1),
    };
  }

  const labsRes = await pool.query(
    `select distinct r.lab_name as lab
     from lab_results_eff r
     join lab_tests t on t.id=r.test_id
     where ${where} and r.lab_name is not null
     order by r.lab_name asc`,
    params
  );

  return { months, rows: Array.from(byTest.values()), labs: labsRes.rows.map((x) => x.lab), pick: q.pick };
}
