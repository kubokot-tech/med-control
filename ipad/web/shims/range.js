// Node's ReadStream end is inclusive. unzipper asks for { start, end } and the archive import depends on that slice.
export function inclusiveSlice(buf, start, end) {
  const from = Math.max(0, Number.isFinite(start) ? start : 0);
  const to = Number.isFinite(end) ? Math.min(buf.length, end + 1) : buf.length;
  return buf.subarray(from, to);
}
