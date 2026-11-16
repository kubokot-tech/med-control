/**
 * Reading IP addresses as numbers, so that two spellings of one address cannot pass for two addresses: brute-force
 * counters (loginGuard.js) and the «own address» check of AI services (llmProviders.js) both depend on that.
 * Pure: no network, no DNS.
 */

/** «1.2.3.4» → [1, 2, 3, 4], or null. Only the plain dotted form (the URL parser already rewrites the exotic ones). */
export function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || ''));
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((x) => x <= 255) ? b : null;
}

/** An IPv6 address (brackets and a zone id allowed, a dotted IPv4 tail allowed) → eight 16-bit groups, or null. */
export function parseIPv6(s) {
  let a = String(s || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!a.includes(':')) return null;
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(a);
  if (tail) {
    const v4 = parseIPv4(tail[2]);
    if (!v4) return null;
    a = `${tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const part = (p) => (p === '' ? [] : p.split(':'));
  const head = part(halves[0]); const rest = halves.length === 2 ? part(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) => parseInt(g, 16));
}

/**
 * The IPv4 address carried inside an IPv6 one, as [a, b, c, d], or null: IPv4-mapped (::ffff:a.b.c.d), the old
 * IPv4-compatible form (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d). Such an address ends up at the IPv4 one.
 */
export function embeddedIPv4(groups) {
  if (!groups) return null;
  const zero = (from, to) => groups.slice(from, to).every((g) => g === 0);
  const mapped = zero(0, 5) && groups[5] === 0xffff;
  const compatible = zero(0, 6) && (groups[6] !== 0 || groups[7] > 1);
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6);
  if (!mapped && !compatible && !nat64) return null;
  return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255];
}

/**
 * The key a client address is counted under. IPv4 as it is (also when it arrives IPv4-mapped); IPv6 by its /64: a
 * home or a server gets a whole /64, so counting single IPv6 addresses would hand every client 2^64 fresh counters.
 */
export function addressKey(ip) {
  const s = String(ip || '').trim().toLowerCase();
  if (!s) return '*';
  const groups = parseIPv6(s);
  if (!groups) return s;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return embeddedIPv4(groups).join('.');
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}
