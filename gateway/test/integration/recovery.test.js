import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { SKIP, setupDb } from './helpers.js';

delete process.env.DTC_PASSWORD; delete process.env.TELEGRAM_BOT_TOKEN;

let db; let app;
before(async () => {
  if (SKIP) return;
  db = await setupDb('recovery');
  const auth = await import('../../src/lib/auth.js');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
  app.decorate('authenticate', auth.authenticate);
  await app.register((await import('../../src/routes/setup.js')).default);
  await app.register(auth.default);
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

const post = (url, body, token) => app.inject({ method: 'POST', url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });

test('the recovery code: given by the wizard, resets a forgotten password once, ends other sessions, can be reissued', { skip: SKIP }, async () => {
  const { normalizeRecoveryCode } = await import('../../src/lib/recovery.js');
  const { checkPassword } = await import('../../src/lib/setup.js');
  const setup = await post('/setup', { password: 'correct horse battery' });
  assert.equal(setup.statusCode, 200, setup.body);
  const { token: oldSession, recoveryCode } = setup.json();
  assert.match(recoveryCode, /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(normalizeRecoveryCode(recoveryCode.toLowerCase().replace(/-/g, ' ')), recoveryCode.replace(/-/g, ''), 'case and separators do not matter');

  const status = await app.inject({ method: 'GET', url: '/auth/recovery', headers: { authorization: `Bearer ${oldSession}` } });
  assert.equal(status.json().exists, true);

  assert.equal((await post('/auth/recover', { code: 'AAAA-AAAA-AAAA-AAAA-AAAA', next: 'brand new password' })).json().error, 'invalid_recovery_code');
  assert.equal((await post('/auth/recover', { code: recoveryCode, next: 'short' })).json().error, 'weak_password');
  assert.equal(checkPassword('correct horse battery'), true, 'refused attempts change nothing');

  const ok = await post('/auth/recover', { code: recoveryCode.toLowerCase(), next: 'brand new password' });
  assert.equal(ok.statusCode, 200, ok.body);
  const { token, recoveryCode: second } = ok.json();
  assert.ok(token && second && second !== recoveryCode);
  assert.equal(checkPassword('brand new password'), true);
  assert.equal(checkPassword('correct horse battery'), false);
  assert.equal((await app.inject({ method: 'GET', url: '/auth/recovery', headers: { authorization: `Bearer ${oldSession}` } })).statusCode, 401, 'old sessions end');
  assert.equal((await post('/auth/recover', { code: recoveryCode, next: 'yet another password' })).json().error, 'invalid_recovery_code', 'a used code is spent');

  // reissue from Settings: the password is asked; the previous code stops working
  assert.equal((await post('/auth/recovery', { password: 'wrong password' }, token)).statusCode, 403);
  const re = await post('/auth/recovery', { password: 'brand new password' }, token);
  assert.equal(re.statusCode, 200, re.body);
  assert.equal((await post('/auth/recover', { code: second, next: 'yet another password' })).json().error, 'invalid_recovery_code');
  assert.equal((await post('/auth/recover', { code: re.json().recoveryCode, next: 'yet another password' })).statusCode, 200);
});
