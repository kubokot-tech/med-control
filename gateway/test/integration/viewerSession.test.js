import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { SKIP, USER_ID, setupDb } from './helpers.js';

process.env.ORTHANC_URL = 'http://orthanc.invalid:8042';
process.env.ORTHANC_USER = 'viewer-test';
process.env.ORTHANC_PASSWORD = 'a-long-random-orthanc-password';

let db; let app;
before(async () => {
  if (SKIP) return;
  db = await setupDb('viewersession');
  const auth = await import('../../src/lib/auth.js');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
  app.decorate('authenticate', auth.authenticate);
  await app.register((await import('../../src/routes/imaging.js')).default);
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

test('the Orthanc viewer opens only with the cookie of a signed-in session; edge gets Orthanc\'s auth, the browser never does', { skip: SKIP }, async () => {
  const { tokenVersion } = await import('../../src/lib/auth.js');
  const session = app.jwt.sign({ sub: USER_ID, tz: 'Europe/Moscow', tv: tokenVersion() });
  const auth = (cookie) => app.inject({ method: 'GET', url: '/orthanc-auth', headers: cookie ? { cookie } : {} });

  assert.equal((await app.inject({ method: 'POST', url: '/imaging/viewer-session' })).statusCode, 401, 'no session, no cookie');
  const r = await app.inject({ method: 'POST', url: '/imaging/viewer-session', headers: { authorization: `Bearer ${session}` } });
  assert.equal(r.statusCode, 200, r.body);
  const setCookie = String(r.headers['set-cookie']);
  assert.match(setCookie, /^mc_viewer=[^;]+; Path=\/orthanc; Max-Age=28800; HttpOnly; SameSite=Strict/);
  assert.ok(!/Basic|viewer-test/.test(r.body + setCookie), 'nothing about Orthanc\'s credentials reaches the browser');
  const cookie = `other=1; ${setCookie.split(';')[0]}`;

  const ok = await auth(cookie);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers.authorization, `Basic ${Buffer.from('viewer-test:a-long-random-orthanc-password').toString('base64')}`);

  assert.equal((await auth()).statusCode, 401);
  assert.match((await auth()).body, /Открыть снимки/);
  assert.equal((await auth(`mc_viewer=${session}`)).statusCode, 401, 'a session token is not a viewer cookie');
  assert.equal((await auth('mc_viewer=garbage')).statusCode, 401);

  // «Выйти везде» / a new password bump token_version: the viewer closes too
  const { setSetting } = await import('../../src/lib/settings.js');
  await setSetting('token_version', String(tokenVersion() + 1));
  assert.equal((await auth(cookie)).statusCode, 401);
});
