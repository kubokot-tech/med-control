import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginGuard, safeEqual } from '../src/lib/loginGuard.js';

test('locks after threshold and grows exponentially', () => {
  let t = 0;
  const g = createLoginGuard({ threshold: 3, baseLockMs: 1000, maxLockMs: 5000, now: () => t });
  assert.equal(g.fail(), 0);
  assert.equal(g.fail(), 0);
  assert.equal(g.fail(), 1000);
  t = 1000;
  assert.equal(g.retryAfterMs(), 0);
  assert.equal(g.fail(), 2000);
  t = 3000;
  assert.equal(g.fail(), 4000);
  t = 7000;
  assert.equal(g.fail(), 5000, 'capped at maxLockMs');
});

test('success resets the counter', () => {
  let t = 0;
  const g = createLoginGuard({ threshold: 2, baseLockMs: 1000, now: () => t });
  g.fail(); g.fail();
  assert.ok(g.retryAfterMs() > 0);
  g.succeed();
  assert.equal(g.retryAfterMs(), 0);
  assert.equal(g.failures, 0);
});

test('per-address lock does not lock other addresses; global net still applies', () => {
  let t = 0;
  const g = createLoginGuard({ threshold: 2, globalThreshold: 5, baseLockMs: 1000, now: () => t });
  g.fail('1.1.1.1'); g.fail('1.1.1.1');
  assert.ok(g.retryAfterMs('1.1.1.1') > 0);
  assert.equal(g.retryAfterMs('2.2.2.2'), 0);
  g.fail('2.2.2.2'); g.fail('3.3.3.3'); g.fail('4.4.4.4');
  assert.ok(g.retryAfterMs('9.9.9.9') > 0, 'global threshold reached');
  g.succeed('1.1.1.1');
  assert.equal(g.retryAfterMs('1.1.1.1'), 0);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
  assert.equal(safeEqual('пароль', 'пароль'), true);
});

test('a failure counted per address only does not move the global net', () => {
  const g = createLoginGuard({ threshold: 2, globalThreshold: 3, baseLockMs: 1000, now: () => 0 });
  for (let i = 0; i < 5; i += 1) g.failIp(`10.0.0.${i}`);
  assert.equal(g.failures, 0);
  assert.equal(g.retryAfterMs('10.0.0.99'), 0);
  g.failIp('10.0.0.1');
  assert.ok(g.retryAfterIpMs('10.0.0.1') > 0, 'the address itself is locked');
});

test('rate limit: a fixed window per address', async () => {
  const { createRateLimit } = await import('../src/lib/loginGuard.js');
  let t = 0;
  const r = createRateLimit({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(r.hit('a'), 0); assert.equal(r.hit('a'), 0);
  assert.equal(r.hit('a'), 1000);
  assert.equal(r.hit('b'), 0, 'other addresses are not affected');
  t = 1000;
  assert.equal(r.hit('a'), 0, 'a new window');
});

test('an IPv6 client is counted by its /64: a new address inside the same network is the same client', async () => {
  const { addressKey } = await import('../src/lib/ipAddr.js');
  assert.equal(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(addressKey('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64', 'another spelling, the same network');
  assert.equal(addressKey('[2001:db8:1:2::7]'), '2001:db8:1:2::/64');
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64', 'a zone id is not part of the address');
  assert.notEqual(addressKey('2001:db8:1:3::1'), addressKey('2001:db8:1:2::1'), 'the next /64 is somebody else');
  assert.equal(addressKey('::ffff:203.0.113.7'), '203.0.113.7', 'IPv4-mapped is that IPv4 client');
  assert.equal(addressKey('::ffff:cb00:7107'), '203.0.113.7');
  assert.equal(addressKey('203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey(''), '*');
  assert.equal(addressKey(undefined), '*');

  const g = createLoginGuard({ threshold: 3, globalThreshold: Infinity, baseLockMs: 1000, now: () => 0 });
  g.fail('2001:db8:1:2::1'); g.fail('2001:db8:1:2::2'); g.fail('2001:db8:1:2:ffff:ffff:ffff:ffff');
  assert.ok(g.retryAfterMs('2001:db8:1:2::abcd') > 0, 'a fourth address of the same /64 is locked too');
  assert.equal(g.failuresFor('2001:db8:1:2::9'), 3);
  assert.equal(g.retryAfterMs('2001:db8:1:3::1'), 0, 'another /64 is not');
  g.succeed('2001:db8:1:2::5');
  assert.equal(g.retryAfterMs('2001:db8:1:2::1'), 0, 'a success from the network clears it');

  const { createRateLimit } = await import('../src/lib/loginGuard.js');
  const r = createRateLimit({ limit: 2, windowMs: 1000, now: () => 0 });
  r.hit('2001:db8::1'); r.hit('2001:db8::2');
  assert.ok(r.hit('2001:db8::3') > 0, 'the rate limit counts the /64 as well');
});

test('slow cap: many addresses together get `limit` guesses, then everybody waits a fixed, short time', () => {
  let t = 0;
  const g = createLoginGuard({ threshold: 5, globalThreshold: Infinity, slowCap: { limit: 10, windowMs: 60_000, lockMs: 30_000 }, now: () => t });
  for (let i = 0; i < 9; i += 1) g.fail(`198.51.100.${i}`);
  assert.equal(g.retryAfterMs('203.0.113.1'), 0, 'below the cap nobody else waits');
  g.fail('198.51.100.9');
  assert.equal(g.retryAfterMs('203.0.113.1'), 30_000, 'the tenth wrong guess closes the door for everybody');
  g.succeed('203.0.113.1');
  assert.equal(g.retryAfterMs('203.0.113.1'), 30_000, 'a success elsewhere does not lift it');
  t = 30_000;
  assert.equal(g.retryAfterMs('203.0.113.1'), 0, 'and it opens again by itself');
  // the lock never doubles: the next round costs the same half minute
  for (let i = 0; i < 10; i += 1) g.fail(`198.51.101.${i}`);
  assert.equal(g.retryAfterMs('203.0.113.1'), 30_000);
  // guesses spread thinner than the window never trip it
  t = 100_000;
  const slow = createLoginGuard({ threshold: 5, globalThreshold: Infinity, slowCap: { limit: 3, windowMs: 1000, lockMs: 30_000 }, now: () => t });
  for (let i = 0; i < 20; i += 1) { slow.fail(`198.51.100.${i}`); t += 1000; }
  assert.equal(slow.retryAfterMs('203.0.113.1'), 0);
});

test('slow cap: addresses it does not apply to are neither counted nor held up', () => {
  const home = (ip) => !String(ip).startsWith('192.168.');
  const g = createLoginGuard({ threshold: 50, globalThreshold: Infinity, slowCap: { limit: 3, windowMs: 60_000, lockMs: 30_000, applies: home }, now: () => 0 });
  for (let i = 0; i < 10; i += 1) g.fail('192.168.1.5');
  assert.equal(g.retryAfterMs('203.0.113.1'), 0, 'wrong guesses at home do not close the door for the internet');
  for (let i = 0; i < 3; i += 1) g.fail(`198.51.100.${i}`);
  assert.ok(g.retryAfterMs('203.0.113.1') > 0, 'strangers closed it for strangers');
  assert.equal(g.retryAfterMs('192.168.1.7'), 0, 'the owner at home still gets in');
});

test('without a slow cap the guard is as before', () => {
  const g = createLoginGuard({ threshold: 2, globalThreshold: Infinity, now: () => 0 });
  for (let i = 0; i < 100; i += 1) g.fail(`198.51.100.${i}`);
  assert.equal(g.retryAfterMs('203.0.113.1'), 0);
});
