import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { SKIP, setupDb } from './helpers.js';

delete process.env.DTC_PASSWORD; delete process.env.TELEGRAM_BOT_TOKEN;

let db; let app;
before(async () => {
  if (SKIP) return;
  db = await setupDb('authlockout');
  const auth = await import('../../src/lib/auth.js');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
  app.decorate('authenticate', auth.authenticate);
  await app.register((await import('../../src/routes/setup.js')).default);
  await app.register(auth.default);
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

const PW = 'correct horse battery';
const login = (ip, body) => app.inject({ method: 'POST', url: '/auth/login', remoteAddress: ip, payload: { login: 'me@example.com', ...body } });

test('strangers guessing from many addresses lock out unknown devices, not the owner\'s known device or settings', { skip: SKIP }, async () => {
  const setup = await app.inject({ method: 'POST', url: '/setup', payload: { password: PW } });
  const { token, device } = setup.json();
  assert.ok(device, 'the wizard gives the known-device mark');
  assert.equal((await app.inject({ method: 'GET', url: '/auth/recovery', headers: { authorization: `Bearer ${device}` } })).statusCode, 401, 'the mark opens nothing');

  // 25 wrong passwords, each from its own address: the global net closes
  for (let i = 0; i < 25; i += 1) assert.equal((await login(`198.51.100.${i}`, { password: 'wrong guess' })).statusCode, 401);
  assert.equal((await login('203.0.113.7', { password: PW })).statusCode, 429, 'a new device waits like everyone');

  const ok = await login('203.0.113.7', { password: PW, device });
  assert.equal(ok.statusCode, 200, 'the owner\'s known device signs in');
  assert.ok(ok.json().device);

  // a forged mark does not help
  const forged = device.slice(0, -4) + 'AAAA';
  for (let i = 0; i < 25; i += 1) await login(`198.51.100.${i}`, { password: 'wrong guess' });
  assert.equal((await login('203.0.113.8', { password: PW, device: forged })).statusCode, 429);

  // inside a session the password check is per address: the global lock does not block settings
  const re = await app.inject({ method: 'POST', url: '/auth/recovery', remoteAddress: '203.0.113.7', headers: { authorization: `Bearer ${ok.json().token}` }, payload: { password: PW } });
  assert.equal(re.statusCode, 200, re.body);
  assert.ok(token);
});
