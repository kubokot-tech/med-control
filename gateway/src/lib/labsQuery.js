/** Shared query helpers for the labs routes (summary, series, exports). */

export const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseYm(s) {
  if (!s) return null;
  const m = /^\d{4}-\d{2}$/.exec(String(s));
  return m ? m[0] : null;
}

/** First day of the month after YYYY-MM, as YYYY-MM-01. */
export function nextMonthStart(ym) {
  const [y, m] = ym.split('-').map((x) => parseInt(x, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/**
 * Build the WHERE clause shared by every lab_results query.
 * Aliases expected in the SQL: r = lab_results, t = lab_tests.
 */
export function buildLabsWhere({ userId, fromYm, toYm, cat, lab }) {
  const where = ['r.user_id = $1'];
  const params = [userId];
  const from = parseYm(fromYm);
  const to = parseYm(toYm);
  if (from) {
    params.push(from + '-01');
    where.push(`r.collected_at >= ($${params.length}::date)`);
  }
  if (to) {
    params.push(nextMonthStart(to));
    where.push(`r.collected_at < ($${params.length}::date)`);
  }
  if (cat === 'blood' || cat === 'urine') {
    params.push(cat);
    where.push(`t.category = $${params.length}`);
  }
  if (lab) {
    params.push(lab);
    where.push(`r.lab_name = $${params.length}`);
  }
  return { where: where.join(' and '), params };
}

export function readLabsQuery(req) {
  const q = req.query || {};
  return {
    userId: req.user.sub,
    fromYm: q.from_ym,
    toYm: q.to_ym,
    cat: (q.cat || '').toString().trim(),
    lab: (q.lab || '').toString().trim(),
    range: (q.range || '').toString().trim(),
    pick: ['worst', 'latest', 'max'].includes(String(q.pick || '')) ? String(q.pick) : 'worst',
  };
}

/**
 * ORDER BY tail that picks one result per (test, month) for the pivot:
 * worst = the value farthest outside its own reference (relative), then the highest; latest = most recent; max = highest.
 */
export function monthPickOrder(pick) {
  if (pick === 'latest') return 'r.collected_at desc';
  if (pick === 'max') return '(r.value_numeric is null), r.value_numeric desc nulls last, r.collected_at desc';
  return `(r.value_numeric is null),
          greatest(coalesce((r.value_numeric - r.ref_high) / nullif(abs(r.ref_high), 0), 0), coalesce((r.ref_low - r.value_numeric) / nullif(abs(r.ref_low), 0), 0)) desc nulls last,
          r.value_numeric desc nulls last, r.collected_at desc`;
}

const RANGE_MONTHS = { '1m': 1, '3m': 3, '6m': 6, '12m': 12, '1': 1, '3': 3, '6': 6, '12': 12 };

/** Keep only the last N months according to range ('3m', '3', 'all', ''). */
export function sliceMonthsByRange(months, range) {
  if (!range || range === 'all') return months;
  const n = RANGE_MONTHS[range];
  return n ? months.slice(Math.max(0, months.length - n)) : months;
}

/** A range as text: «3,4–20,5», «≤ 5», «≥ 1»; '' without one. `fmt` formats a number. */
export function refText(low, high, fmt = String) {
  if (low != null && high != null) return `${fmt(low)}–${fmt(high)}`;
  if (high != null) return `≤ ${fmt(high)}`;
  if (low != null) return `≥ ${fmt(low)}`;
  return '';
}

/** 'high' | 'low' | 'ok' against a range that may be open on one side («< 5» is (null, 5)); '' without a value or a range. */
export function flag(valNum, refLow, refHigh) {
  if (valNum == null || (refLow == null && refHigh == null)) return '';
  const v = Number(valNum);
  const lo = refLow == null ? null : Number(refLow);
  const hi = refHigh == null ? null : Number(refHigh);
  if (Number.isNaN(v)) return '';
  if (hi != null && v > hi) return 'high';
  if (lo != null && v < lo) return 'low';
  return 'ok';
}

/** Correlated subquery resolving the ingest document for a lab_results row (alias r). */
export const DOCUMENT_ID_SUBQUERY = `(
  select d.id
  from attachments a
  join ingest_documents d on d.user_id=a.user_id and d.sha256=a.sha256
  where a.user_id=r.user_id and a.event_id=r.source_event_id
  limit 1
)`;

/** Map ordered lab_results rows to series points with delta to the previous numeric value. */
export function mapSeriesPoints(rows) {
  let prevNum = null;
  return rows.map((row) => {
    const num = row.value_numeric !== null ? Number(row.value_numeric) : null;
    const delta = (num !== null && prevNum !== null) ? (num - prevNum) : null;
    if (num !== null) prevNum = num;
    return {
      date: row.collected_at,
      valueNum: num,
      valueText: row.value_text ?? (num !== null ? String(num) : null),
      unit: row.unit_canonical ?? null,
      refLow: row.ref_low != null ? Number(row.ref_low) : null,
      refHigh: row.ref_high != null ? Number(row.ref_high) : null,
      // where the range comes from ('user' | 'catalog' | 'lab'), and the lab's own (lab_results_eff)
      refSource: row.ref_source ?? null,
      labRefLow: row.lab_ref_low != null ? Number(row.lab_ref_low) : null,
      labRefHigh: row.lab_ref_high != null ? Number(row.lab_ref_high) : null,
      delta,
      test: row.test,
      documentId: row.document_id || null,
    };
  });
}
