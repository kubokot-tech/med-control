import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bodyAllowance, PUBLIC_BODY_ROUTES, PUBLIC_BODY_LIMIT } from '../../shared/proxyGuard.js';

// The frontend's proxy (frontend/app/api/gateway/[...path]/route.ts) holds a body in memory before passing it on.
test('a body without credentials is not read at all, except on the sign-in and first-run routes', () => {
  const none = (p) => assert.equal(bodyAllowance(p.split('/'), null), 'none', p);
  for (const p of ['health/import', 'import/archive', 'labs/upload', 'notes', 'ai/ask', 'mcp', 'auth/password', 'auth/passkey/login/verify', 'auth/logout-all', 'settings/mcp', 'auth/login/extra', 'setup/status', 'auth']) none(p);
  assert.equal(bodyAllowance(['health', 'import'], ''), 'none', 'an empty header is no credentials');
  assert.equal(bodyAllowance(['health', 'import'], '   '), 'none');
  assert.equal(bodyAllowance([], undefined), 'none');
});

test('with credentials the gateway decides; the public routes get a small body', () => {
  assert.equal(bodyAllowance(['health', 'import'], 'Bearer dtc_key'), 'full');
  assert.equal(bodyAllowance(['import', 'archive'], 'Bearer session'), 'full');
  assert.equal(bodyAllowance(['auth', 'login'], 'Bearer session'), 'full');
  for (const p of PUBLIC_BODY_ROUTES) assert.equal(bodyAllowance(p.split('/'), null), 'small', p);
  assert.ok(PUBLIC_BODY_LIMIT <= 256 * 1024 && PUBLIC_BODY_LIMIT >= 16 * 1024, 'room for a passkey answer, not for megabytes');
});

test('the public list is exactly the gateway routes that take a body from somebody not signed in', () => {
  // routes registered without a preHandler/onRequest check, in the two files that have them
  const src = ['../src/lib/auth.js', '../src/routes/setup.js'].map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')).join('\n');
  const open = [...src.matchAll(/app\.(?:post|put|patch|delete)\('\/([^']+)', async/g)].map((m) => m[1]).sort();
  assert.deepEqual(open, [...PUBLIC_BODY_ROUTES].sort());
});

test('the proxy asks before it reads the body', () => {
  const route = readFileSync(fileURLToPath(new URL('../../frontend/app/api/gateway/[...path]/route.ts', import.meta.url)), 'utf8');
  const ask = route.indexOf("bodyAllowance(path, req.headers.get('authorization'))");
  const refuse = route.indexOf("if (allowance === 'none') return json(401");
  const read = route.indexOf('await readBody(req,');
  const stream = route.indexOf('limitedStream(req, MAX_ARCHIVE)');
  assert.ok(ask > 0 && refuse > ask && read > refuse && stream > refuse, 'allowance → 401 → only then the body');
});
