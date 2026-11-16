import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { desktopHostGuard } from '../src/lib/hostGuard.js';

test('desktop gateway: only requests naming this machine pass (DNS rebinding pages are refused)', async () => {
  const app = Fastify();
  app.addHook('onRequest', desktopHostGuard(3700));
  app.get('/health', async () => ({ ok: true }));
  const status = async (host) => (await app.inject({ method: 'GET', url: '/health', headers: { host } })).statusCode;
  assert.equal(await status('127.0.0.1:3700'), 200, 'the Next server');
  assert.equal(await status('127.0.0.1'), 200, 'the launcher health probe sends no port');
  assert.equal(await status('localhost:3700'), 200);
  assert.equal(await status('evil.example:3700'), 403, 'a rebinding page');
  assert.equal(await status('127.0.0.1:3001'), 403, 'another port');
  await app.close();
});
