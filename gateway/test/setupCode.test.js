import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupCodeRequired } from '../src/lib/setupCode.js';

test('the wizard asks for a code only when the site is reachable from other machines', () => {
  const keep = { ...process.env };
  try {
    for (const k of ['APP_URL', 'DTC_BIND_ADDR', 'DTC_SETUP_CODE', 'DTC_EDITION']) delete process.env[k];
    assert.equal(setupCodeRequired(), false, 'defaults: localhost, bound to 127.0.0.1');
    process.env.APP_URL = 'http://127.0.0.1:3201'; process.env.DTC_BIND_ADDR = '127.0.0.1';
    assert.equal(setupCodeRequired(), false);
    process.env.DTC_BIND_ADDR = '0.0.0.0';
    assert.equal(setupCodeRequired(), true, 'open to the local network');
    process.env.DTC_BIND_ADDR = '127.0.0.1'; process.env.APP_URL = 'https://med.example.org';
    assert.equal(setupCodeRequired(), true, 'published under a name');
    process.env.DTC_SETUP_CODE = 'off';
    assert.equal(setupCodeRequired(), false, 'the admin may switch it off');
    delete process.env.DTC_SETUP_CODE; process.env.DTC_EDITION = 'desktop';
    assert.equal(setupCodeRequired(), false, 'the desktop app listens on 127.0.0.1 only');
  } finally { process.env = keep; }
});

test('a request from the internet needs the code even when the settings say «this machine only»', async () => {
  const { publicAddress } = await import('../src/lib/setupCode.js');
  const keep = { ...process.env };
  try {
    for (const k of ['APP_URL', 'DTC_BIND_ADDR', 'DTC_SETUP_CODE', 'DTC_EDITION']) delete process.env[k];
    assert.equal(setupCodeRequired('172.18.0.1'), false, 'the browser on this machine through Docker');
    assert.equal(setupCodeRequired('192.168.1.20'), false, 'the home network');
    assert.equal(setupCodeRequired('100.101.102.103'), false, 'Tailscale');
    assert.equal(setupCodeRequired('203.0.113.9'), true, 'a tunnel from the internet');
    assert.equal(setupCodeRequired('::ffff:203.0.113.9'), true);
    assert.deepEqual(['::1', 'fd00::1', 'fe80::1', '2001:db8::1'].map(publicAddress), [false, false, false, true]);
    process.env.DTC_EDITION = 'desktop';
    assert.equal(setupCodeRequired('203.0.113.9'), false, 'the desktop app listens on 127.0.0.1 only');
  } finally { process.env = keep; }
});
