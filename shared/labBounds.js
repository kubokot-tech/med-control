/** Comparison is conclusive only when every possible value satisfies the condition. */
export const comparatorOf = (text) => /^\s*([<>≤≥]=?)/.exec(String(text ?? ''))?.[1] || '';

export function definitely(value, comparator, op, limit) {
  if (limit == null || value == null) return false;
  const below = ['<', '<=', '≤'].includes(comparator);
  const above = ['>', '>=', '≥'].includes(comparator);
  if (op === 'lt' || op === 'lte') {
    if (above) return false;
    return value < limit || (value === limit && (op === 'lte' || comparator === '<'));
  }
  if (below) return false;
  return value > limit || (value === limit && (op === 'gte' || comparator === '>'));
}

export function rangeFlag(value, low, high, text) {
  if (value == null || (low == null && high == null)) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const cmp = comparatorOf(text);
  if (high != null && definitely(n, cmp, 'gt', Number(high))) return 'high';
  if (low != null && definitely(n, cmp, 'lt', Number(low))) return 'low';
  if ((low == null || definitely(n, cmp, 'gte', Number(low))) &&
      (high == null || definitely(n, cmp, 'lte', Number(high)))) return 'ok';
  return '';
}
