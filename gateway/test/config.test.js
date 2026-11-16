import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('jwt secret: generated once into DATA_DIR when .env has none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-jwt-'));
  process.env.DTC_DATA_DIR = dir; delete process.env.JWT_SECRET;
  const { resolveJwtSecret } = await import('../src/lib/config.js');
  const a = resolveJwtSecret();
  assert.ok(a.length >= 32);
  assert.equal(fs.readFileSync(path.join(dir, 'jwt.secret'), 'utf8').trim(), a);
  assert.equal(resolveJwtSecret(), a, 'stable across restarts');
  process.env.JWT_SECRET = 'change_me';
  assert.throws(() => resolveJwtSecret(), /at least 32/);
  process.env.JWT_SECRET = 'x'.repeat(40);
  assert.equal(resolveJwtSecret(), 'x'.repeat(40), '.env wins');
});
