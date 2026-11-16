import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edition, available, requireFeature, editionInfo } from '../src/lib/edition.js';

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
  } finally { if (saved === undefined) delete process.env.DTC_EDITION; else process.env.DTC_EDITION = saved; }
});
