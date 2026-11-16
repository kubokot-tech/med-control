import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { RU_CA_FILE, RU_CA_SHA256, SBER_HOSTS, sberFetch } from '../src/lib/sberTls.js';

test('the bundled certificate is the Ministry root we pinned, and still valid for a year', () => {
  const cert = new X509Certificate(fs.readFileSync(RU_CA_FILE));
  assert.equal(cert.fingerprint256, RU_CA_SHA256);
  assert.match(cert.subject, /CN=Russian Trusted Root CA/);
  assert.ok(cert.ca);
  assert.ok(new Date(cert.validTo) > new Date(Date.now() + 365 * 86400_000), `expires ${cert.validTo}: ship the new root`);
});

test('the extra root is used for Sber hosts only', async () => {
  const seen = [];
  const fake = async (url, init) => { seen.push({ host: new URL(url).hostname, dispatcher: Boolean(init.dispatcher) }); return new Response('{}'); };
  for (const host of SBER_HOSTS) await sberFetch(`https://${host}/x`, {}, fake);
  await sberFetch('https://openrouter.ai/api/v1/models', {}, fake);
  assert.deepEqual(seen, [
    { host: 'ngw.devices.sberbank.ru', dispatcher: true },
    { host: 'gigachat.devices.sberbank.ru', dispatcher: true },
    { host: 'openrouter.ai', dispatcher: false },
  ]);
});
