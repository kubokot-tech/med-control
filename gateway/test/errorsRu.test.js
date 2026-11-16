import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Error messages live in the shared dictionary (locales/ru/errors.json), see docs/I18N.md.
const ERRORS_RU = JSON.parse(readFileSync(fileURLToPath(new URL('../../locales/ru/errors.json', import.meta.url)), 'utf8'));

test('every message in the errors dictionary is non-empty text', () => {
  assert.ok(Object.keys(ERRORS_RU).length > 50);
  for (const [code, msg] of Object.entries(ERRORS_RU)) {
    assert.match(code, /^[a-z_]+$/);
    assert.ok(typeof msg === 'string' && msg.trim(), code);
  }
});

test('every error code used in routes has a message', () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const missing = new Set();
  for (const sub of ['routes', 'lib']) {
    for (const f of readdirSync(dir + sub, { recursive: true })) {
      if (!f.endsWith('.js')) continue;
      const src = readFileSync(dir + sub + '/' + f, 'utf8');
      // replies by hand and CoreError codes of the core (invalid/notFound/conflict in lib/errors.js)
      for (const m of src.matchAll(/error: '([a-z_]+)'|\b(?:invalid|notFound|conflict)\('([a-z_]+)'/g)) { const code = m[1] || m[2]; if (!ERRORS_RU[code]) missing.add(code); }
    }
  }
  assert.deepEqual([...missing], []);
});
