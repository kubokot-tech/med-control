import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edition, platform, available, requireFeature, editionInfo } from '../src/lib/edition.js';

test('server edition has everything; desktop switches server-only features off with a server_only error', () => {
  const saved = process.env.DTC_EDITION;
  try {
    delete process.env.DTC_EDITION;
    assert.equal(edition(), 'server');
    assert.ok(available('appleHealth') && available('passkeys'));
    assert.deepEqual(editionInfo().unavailable, []);
    process.env.DTC_EDITION = 'desktop';
    assert.equal(edition(), 'desktop');
    assert.equal(available('appleHealth'), false);
    assert.equal(available('dicom'), false);
    assert.equal(available('telegram'), true, 'not in the list: available');
    assert.throws(() => requireFeature('passkeys'), (e) => e.name === 'CoreError' && e.code === 'server_only' && e.kind === 'conflict');
    assert.deepEqual(editionInfo(), { edition: 'desktop', unavailable: ['appleHealth', 'dicom', 'backups', 'passkeys', 'egress'] });
    process.env.DTC_EDITION = 'ipad';
    assert.equal(edition(), 'desktop');
    assert.equal(platform(), 'ipad');
    assert.equal(editionInfo().edition, 'desktop');
    assert.equal(available('telegram'), false);
    assert.equal(available('appleHealth'), false);
    assert.throws(() => requireFeature('telegram'), (e) => e.code === 'server_only');
    assert.deepEqual(editionInfo().unavailable, ['appleHealth', 'dicom', 'backups', 'passkeys', 'egress', 'telegram']);
    process.env.DTC_EDITION = ' iPad ';
    assert.equal(platform(), 'ipad', 'the value is trimmed and lowercased');
    assert.equal(edition(), 'desktop');
    process.env.DTC_EDITION = 'desktop';
    assert.equal(platform(), 'desktop');
    assert.equal(available('telegram'), true, 'desktop keeps Telegram');
    delete process.env.DTC_EDITION;
    assert.equal(platform(), 'server');
  } finally { if (saved === undefined) delete process.env.DTC_EDITION; else process.env.DTC_EDITION = saved; }
});
