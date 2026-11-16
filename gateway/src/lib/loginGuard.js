import { timingSafeEqual } from 'node:crypto';
import { addressKey } from './ipAddr.js';

/**
 * A slow cap over all addresses together, for guards that otherwise count per address only: without it, somebody with
 * many addresses (a botnet, a rented IPv6 block) gets `threshold` guesses from each and can guess forever. It is not
 * the global net of the sign-in guard: the lock is fixed and short, never doubles and is not lifted by a success, so
 * whoever trips it holds everybody up for `lockMs` at most per `limit` wrong guesses. `applies(ip)` leaves some
 * addresses out (the first-run code: the owner's own machine and home network).
 */
function createSlowCap({ limit, windowMs, lockMs, applies = () => true }, now) {
  let start = 0; let n = 0; let lockedUntil = 0;
  return {
    left: (ip) => (applies(ip) ? Math.max(0, lockedUntil - now()) : 0),
    fail(ip) {
      if (!applies(ip)) return 0;
      const t = now();
      if (t - start >= windowMs) { start = t; n = 0; }
      n += 1;
      if (n >= limit) { lockedUntil = t + lockMs; start = t; n = 0; }
      return Math.max(0, lockedUntil - t);
    },
  };
}

/**
 * Brute-force guard for a single-user login: a counter per client address (real IP arrives via the
 * trusted reverse proxy; an IPv6 client is counted by its /64, lib/ipAddr.js) plus a global counter as a safety net
 * against distributed attempts. After `threshold` failures the address is locked; each further failure doubles the
 * lock, up to `maxLockMs`. `slowCap` ({ limit, windowMs, lockMs, applies }): see createSlowCap above.
 */
export function createLoginGuard({ threshold = 5, globalThreshold = 25, baseLockMs = 60_000, maxLockMs = 3_600_000, slowCap = null, now = Date.now } = {}) {
  const global = { failures: 0, lockedUntil: 0 };
  const perIp = new Map();
  const slow = slowCap ? createSlowCap(slowCap, now) : { left: () => 0, fail: () => 0 };
  const PRUNE_MS = 2 * maxLockMs;
  function entry(ip) {
    const key = addressKey(ip);
    let e = perIp.get(key);
    if (!e) { e = { failures: 0, lockedUntil: 0, seen: now() }; perIp.set(key, e); }
    e.seen = now();
    if (perIp.size > 1000) for (const [k, v] of perIp) if (now() - v.seen > PRUNE_MS) perIp.delete(k);
    return e;
  }
  const left = (e) => Math.max(0, e.lockedUntil - now());
  function bump(e, thr) {
    e.failures += 1;
    if (e.failures >= thr) e.lockedUntil = now() + Math.min(maxLockMs, baseLockMs * 2 ** (e.failures - thr));
    return left(e);
  }
  return {
    /** ms left before another attempt from this address is allowed, 0 if allowed. */
    retryAfterMs(ip) { return Math.max(left(global), left(entry(ip)), slow.left(ip)); },
    /** Per-address lock only: passkeys cannot be brute-forced, so the global net must not lock the owner out of them. */
    retryAfterIpMs(ip) { return left(entry(ip)); },
    fail(ip) { const g = Math.max(bump(global, globalThreshold), slow.fail(ip)); return Math.max(g, bump(entry(ip), threshold)); },
    /** A failure that counts only against this address (a known device, a check inside a session). */
    failIp(ip) { return bump(entry(ip), threshold); },
    succeed(ip) { global.failures = 0; global.lockedUntil = 0; perIp.delete(addressKey(ip)); },
    get failures() { return global.failures; },
    failuresFor(ip) { return perIp.get(addressKey(ip))?.failures || 0; },
  };
}

/**
 * Fixed-window request limit per address (IPv6: per /64) for anonymous endpoints that cost the server something (passkey options).
 * hit() returns ms to wait, 0 when the request may go on.
 */
export function createRateLimit({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
  const seen = new Map();
  return {
    hit(ip) {
      const key = addressKey(ip); const t = now();
      let e = seen.get(key);
      if (!e || t - e.start >= windowMs) { e = { start: t, n: 0 }; seen.set(key, e); }
      if (seen.size > 5000) for (const [k, v] of seen) if (t - v.start >= windowMs) seen.delete(k);
      e.n += 1;
      return e.n > limit ? e.start + windowMs - t : 0;
    },
  };
}

/** Constant-time string comparison that does not leak length via early exit. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
