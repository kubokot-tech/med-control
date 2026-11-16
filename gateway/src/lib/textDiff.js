/** Line diff (LCS) for anamnesis versions: [{ type: 'same'|'add'|'del', text }]. `add` = in `after` only. */
export function lineDiff(before, after, { maxLines = 3000 } = {}) {
  const a = String(before || '').split('\n').slice(0, maxLines);
  const b = String(after || '').split('\n').slice(0, maxLines);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}
export function diffStats(d) {
  return { added: d.filter((x) => x.type === 'add').length, removed: d.filter((x) => x.type === 'del').length };
}
