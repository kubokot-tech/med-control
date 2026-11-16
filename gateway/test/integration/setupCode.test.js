import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { SKIP, setupDb } from './helpers.js';

delete process.env.DTC_PASSWORD; delete process.env.TELEGRAM_BOT_TOKEN;
process.env.APP_URL = 'https://med.example.org';
process.env.DTC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dtc-setupcode-'));

let db; let app;
before(async () => {
  if (SKIP) return;
  db = await setupDb('setupcode');
  process.env.DTC_SETUP_CODE = ''; // helpers switch it off for other tests; here the published-install rule applies
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
  await app.register((await import('../../src/routes/setup.js')).default);
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); rmSync(process.env.DTC_DATA_DIR, { recursive: true, force: true }); });

const body = (extra) => ({ password: 'correct horse battery', ...extra });

test('a published install: the wizard needs the code from the server, once, and only one request wins', { skip: SKIP }, async () => {
  const { prepareSetupCode } = await import('../../src/lib/setupCode.js');
  const code = prepareSetupCode(true, { warn() {} });
  const file = path.join(process.env.DTC_DATA_DIR, 'setup-code.txt');
  assert.equal(readFileSync(file, 'utf8').trim(), code);
  assert.equal((await app.inject({ method: 'GET', url: '/setup/status' })).json().codeRequired, true);

  assert.equal((await app.inject({ method: 'POST', url: '/setup', payload: body() })).json().error, 'invalid_setup_code');
  // a weak password is not a guess, and strangers from many addresses do not lock the wizard
  for (let i = 0; i < 12; i += 1) await app.inject({ method: 'POST', url: '/setup', remoteAddress: `198.51.100.${i}`, payload: body({ setupCode: 'AAAA-AAAA' }) });
  assert.notEqual((await app.inject({ method: 'POST', url: '/setup', remoteAddress: '192.0.2.50', payload: body({ password: 'short', setupCode: code }) })).statusCode, 429, 'another address is not locked');
  assert.equal((await app.inject({ method: 'POST', url: '/setup', payload: body({ setupCode: 'AAAA-AAAA' }) })).json().error, 'invalid_setup_code');

  const typed = code.toLowerCase().replace('-', ' ');
  const [a, b] = await Promise.all([
    app.inject({ method: 'POST', url: '/setup', payload: body({ setupCode: typed }) }),
    app.inject({ method: 'POST', url: '/setup', payload: body({ setupCode: typed }) }),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409], `${a.body} ${b.body}`);
  assert.equal(existsSync(file), false, 'the code is gone after use');
  assert.equal((await app.inject({ method: 'GET', url: '/setup/status' })).json().codeRequired, false);
});
