// Guards around guessing: the first-run code, the password asked inside a session, the «known device» mark, and the
// Apple Health import that checks its key before it reads the body.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { SKIP, setupDb } from './helpers.js';

delete process.env.DTC_PASSWORD; delete process.env.TELEGRAM_BOT_TOKEN;
process.env.APP_URL = 'https://med.example.org';
process.env.DTC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dtc-guards-'));

const PW = 'correct horse battery';
let db; let app;
before(async () => {
  if (SKIP) return;
  db = await setupDb('guards');
  process.env.DTC_SETUP_CODE = ''; // helpers switch the code off for other tests; here a published install asks for it
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; // no security notices to Telegram from here
  const auth = await import('../../src/lib/auth.js');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
  app.decorate('authenticate', auth.authenticate);
  await app.register((await import('../../src/routes/setup.js')).default);
  await app.register(auth.default);
  await app.register((await import('../../src/routes/health.js')).default);
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); rmSync(process.env.DTC_DATA_DIR, { recursive: true, force: true }); });

const setup = (ip, body) => app.inject({ method: 'POST', url: '/setup', remoteAddress: ip, payload: { password: PW, ...body } });
/** n requests at once: a wrong password costs half a second each, in a row that is most of a minute. */
const many = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const post = (url, body, { token, ip = '203.0.113.5' } = {}) => app.inject({ method: 'POST', url, remoteAddress: ip, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });

let session; let device;
test('the first-run code: many addresses together cannot guess forever, and the owner at home is not held up by them', { skip: SKIP }, async () => {
  const { prepareSetupCode } = await import('../../src/lib/setupCode.js');
  const code = prepareSetupCode(true, { warn() {} });

  // one address: ten wrong codes, then it waits (as before)
  for (let i = 0; i < 10; i += 1) assert.equal((await setup('198.51.100.200', { setupCode: 'AAAA-AAAA' })).statusCode, 403);
  assert.equal((await setup('198.51.100.200', { setupCode: code })).statusCode, 429);

  // ninety more addresses, one wrong code each: a hundred wrong codes from the internet within ten minutes
  for (let i = 0; i < 89; i += 1) assert.equal((await setup(`198.51.${100 + Math.floor(i / 200)}.${i % 200}`, { setupCode: 'BBBB-BBBB' })).statusCode, 403, `address ${i}`);
  assert.equal((await setup('192.0.2.77', { setupCode: 'CCCC-CCCC' })).statusCode, 403, 'the hundredth');
  const stranger = await setup('192.0.2.78', { setupCode: code });
  assert.equal(stranger.statusCode, 429, 'now the internet waits, the right code included');
  assert.ok(Number(stranger.headers['retry-after']) <= 600, 'ten minutes at most, never doubling');

  // the owner on the same machine or in the home network is neither counted nor locked
  assert.equal((await setup('192.168.1.20', { setupCode: 'DDDD-DDDD' })).statusCode, 403, 'a wrong code at home is still wrong');
  const ok = await setup('192.168.1.20', { setupCode: code });
  assert.equal(ok.statusCode, 200, ok.body);
  ({ token: session, device } = ok.json());
  assert.ok(session && device);
});

test('the «known device» mark stops with the password it was given under', { skip: SKIP }, async () => {
  const login = (ip, body) => post('/auth/login', body, { ip });
  // strangers close the global net of sign-in: 25 wrong passwords from 25 addresses
  for (const r of await many(25, (i) => login(`198.51.110.${i}`, { password: 'wrong guess' }))) assert.equal(r.statusCode, 401);
  assert.equal((await login('203.0.113.60', { password: PW })).statusCode, 429, 'an unknown device waits');
  const known = await login('203.0.113.60', { password: PW, device });
  assert.equal(known.statusCode, 200, 'the owner\'s device passes');
  assert.equal(JSON.parse(Buffer.from(device.split('.')[1], 'base64url').toString()).tv, 0, 'the mark carries the token version');

  // the password is changed (somebody else knew it, a phone was lost): the reply brings a new mark
  const changed = await post('/auth/password', { current: PW, next: 'brand new password' }, { token: known.json().token, ip: '203.0.113.60' });
  assert.equal(changed.statusCode, 200, changed.body);
  const newMark = changed.json().device;
  assert.ok(newMark && newMark !== device, 'this browser gets a new mark with the new password');

  await many(25, (i) => login(`198.51.111.${i}`, { password: 'wrong guess' }));
  assert.equal((await login('203.0.113.61', { password: 'brand new password', device })).statusCode, 429, 'the old mark is a stranger now, even with the right password');
  const again = await login('203.0.113.61', { password: 'brand new password', device: newMark });
  assert.equal(again.statusCode, 200, 'the new mark passes');
  session = again.json().token;

  // «Выйти везде» ends the marks as well
  assert.equal((await post('/auth/logout-all', {}, { token: session })).statusCode, 200);
  await many(25, (i) => login(`198.51.112.${i}`, { password: 'wrong guess' }));
  assert.equal((await login('203.0.113.62', { password: 'brand new password', device: newMark })).statusCode, 429);
});

test('the password asked inside a session: a stolen session guessing from many addresses is capped, slowly', { skip: SKIP }, async () => {
  // a session of our own making: the sign-in net is closed by the test above, and this guard has nothing to do with it
  const { tokenVersion, HARDCODED_USER_ID } = await import('../../src/lib/auth.js');
  const stolen = app.jwt.sign({ sub: HARDCODED_USER_ID, tz: 'Europe/Moscow', tv: tokenVersion() }, { expiresIn: '1h' });
  const confirm = (ip, password) => post('/auth/recovery', { password }, { token: stolen, ip });
  assert.equal((await confirm('203.0.113.70', 'brand new password')).statusCode, 200, 'the owner confirms although sign-in is locked for strangers');

  // twenty wrong passwords, each from its own address: no address reaches its own limit of five
  for (const r of await many(20, (i) => confirm(`198.51.120.${i}`, `guess number ${i}`))) assert.equal(r.statusCode, 403);
  const capped = await confirm('198.51.120.99', 'brand new password');
  assert.equal(capped.statusCode, 429, 'the twenty-first waits, whatever the address');
  assert.ok(capped.json().retryAfterSec <= 30 * 60, 'half an hour at most');
  // «Выйти везде» needs no password: the owner ends the stolen session without waiting
  assert.equal((await post('/auth/logout-all', {}, { token: stolen })).statusCode, 200);
  assert.equal((await confirm('198.51.120.100', 'brand new password')).statusCode, 401, 'the stolen session is over');
});

test('Apple Health import: the key is checked before the body is read', { skip: SKIP }, async () => {
  const send = (payload, headers = {}) => app.inject({ method: 'POST', url: '/health/import', payload, headers: { 'content-type': 'application/json', ...headers } });
  // a body the parser would refuse (400) or that is over the limit (413): without a key the answer is 401, so it was never parsed
  assert.equal((await send('{"data": {"metrics": [')).statusCode, 401);
  assert.equal((await send(Buffer.alloc(26 * 1024 * 1024, 0x20))).statusCode, 401, '26 MB from a stranger');
  assert.equal((await send('{"data": {"metrics": [', { authorization: 'Bearer dtc_not-the-key-not-the-key-not-the-key' })).statusCode, 401);

  // with a session (as the settings page tests it) the body is read and judged
  const { tokenVersion, HARDCODED_USER_ID } = await import('../../src/lib/auth.js');
  const session2 = app.jwt.sign({ sub: HARDCODED_USER_ID, tz: 'Europe/Moscow', tv: tokenVersion() }, { expiresIn: '1h' });
  assert.equal((await send('{"data": {"metrics": [', { authorization: `Bearer ${session2}` })).statusCode, 400, 'broken JSON from the owner is a bad request');
  const empty = await send({ data: { metrics: [] } }, { authorization: `Bearer ${session2}` });
  assert.deepEqual([empty.statusCode, empty.json().error], [400, 'no_samples']);
  const ok = await send({ data: { metrics: [{ name: 'weight_body_mass', units: 'kg', data: [{ date: '2025-01-05 07:00:00 +0300', qty: 80 }] }] } }, { authorization: `Bearer ${session2}` });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().inserted, 1);
});
