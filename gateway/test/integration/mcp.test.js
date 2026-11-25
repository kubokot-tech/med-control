import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db; let app;
const PW = 'correct horse battery';
before(async () => {
  if (SKIP) return;
  db = await setupDb('mcp');
  const { CoreError, HTTP_STATUS, errorBody } = await import('../../src/lib/errors.js');
  app = Fastify();
  // the session check of the real server, reduced to «the user is signed in»
  app.decorate('authenticate', async (req) => { req.user = { sub: USER_ID, tz: 'Europe/Moscow' }; });
  app.setErrorHandler((err, _req, reply) => (err instanceof CoreError ? reply.code(HTTP_STATUS[err.kind]).send(errorBody(err)) : reply.code(500).send({ error: 'internal' })));
  await app.register((await import('../../src/routes/mcp.js')).default);
  await (await import('../../src/lib/setup.js')).completeSetup({ password: PW });
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

const call = (token, body, headers = {}) => app.inject({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, payload: body });
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('MCP: off by default, switched on only with the acknowledgement, per-agent tokens, read and write scopes, audit, revoke', { skip: SKIP }, async () => {
  // off: the endpoint does not exist, tokens cannot be made
  assert.equal((await call(null, rpc('initialize', {}))).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/settings/mcp/tokens', payload: { name: 'x', password: PW } })).json().error, 'mcp_off');
  assert.equal((await app.inject({ method: 'PUT', url: '/settings/mcp', payload: { enabled: true, acknowledged: true } })).statusCode, 403, 'switching on needs the password');
  assert.equal((await app.inject({ method: 'PUT', url: '/settings/mcp', payload: { enabled: true, password: PW } })).json().error, 'mcp_ack_required');
  assert.equal((await app.inject({ method: 'PUT', url: '/settings/mcp', payload: { enabled: true, acknowledged: true, password: PW } })).json().enabled, true);

  assert.equal((await app.inject({ method: 'POST', url: '/settings/mcp/tokens', payload: { name: 'без пароля' } })).statusCode, 403, 'a stolen session alone cannot make a token');
  const read = (await app.inject({ method: 'POST', url: '/settings/mcp/tokens', payload: { name: 'Claude Desktop', password: PW } })).json();
  const write = (await app.inject({ method: 'POST', url: '/settings/mcp/tokens', payload: { name: 'Агент-писатель', scope: 'write', password: PW } })).json();
  assert.match(read.token, /^mcp_/);
  assert.equal(read.info.scope, 'read');
  const stored = await db.pool.query('select token_hash from mcp_tokens');
  assert.ok(stored.rows.every((r) => !r.token_hash.includes(read.token) && r.token_hash.length === 64), 'only hashes are stored');

  // authentication and origin
  assert.equal((await call(null, rpc('initialize', {}))).statusCode, 401);
  assert.equal((await call('mcp_' + 'x'.repeat(43), rpc('initialize', {}))).statusCode, 401);
  assert.equal((await call(read.token, rpc('initialize', {}), { origin: 'https://evil.example' })).statusCode, 403);

  // protocol
  const init = (await call(read.token, rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }))).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'medcontrol');
  assert.equal((await call(read.token, { jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode, 202);
  const readTools = (await call(read.token, rpc('tools/list'))).json().result.tools.map((t) => t.name);
  assert.ok(readTools.includes('get_patient_profile') && readTools.includes('get_lab_results'));
  assert.ok(!readTools.includes('add_note'), 'a read token does not see write tools');
  const writeTools = (await call(write.token, rpc('tools/list'))).json().result.tools.map((t) => t.name);
  assert.ok(writeTools.includes('add_note') && writeTools.includes('add_diary_entry'));

  // reading
  const profile = (await call(read.token, rpc('tools/call', { name: 'get_patient_profile', arguments: {} }))).json().result;
  assert.equal(profile.isError, false);
  assert.equal(typeof profile.structuredContent.profile, 'string');
  const markers = (await call(read.token, rpc('tools/call', { name: 'list_lab_markers', arguments: {} }))).json().result.structuredContent.markers;
  assert.ok(markers.some((m) => m.key === 'ALT'));
  const bad = (await call(read.token, rpc('tools/call', { name: 'get_lab_results', arguments: { from: 'вчера' } }))).json();
  assert.equal(bad.error.code, -32602);
  const denied = (await call(read.token, rpc('tools/call', { name: 'add_note', arguments: { title: 'x', body: 'y' } }))).json();
  assert.equal(denied.error.code, -32602, 'read token cannot write');

  // writing
  const note = (await call(write.token, rpc('tools/call', { name: 'add_note', arguments: { title: 'Сводка агента', body: 'Текст' } }))).json().result;
  assert.equal(note.structuredContent.ok, true);
  const n = await db.pool.query('select title, tags, source_name from notes where id = $1', [note.structuredContent.noteId]);
  assert.deepEqual([n.rows[0].title, n.rows[0].tags, n.rows[0].source_name], ['Сводка агента', ['ии-агент'], 'MCP: Агент-писатель']);
  const diary = (await call(write.token, rpc('tools/call', { name: 'add_diary_entry', arguments: { date: '2026-01-05', bpSys: 130, bpDia: 85 } }))).json().result;
  assert.equal(diary.structuredContent.ok, true);

  // audit: methods and tools, never the data
  const s = (await app.inject({ method: 'GET', url: '/settings/mcp' })).json();
  assert.ok(s.audit.some((a) => a.tool === 'add_note' && a.ok && a.token === 'Агент-писатель'));
  assert.ok(s.audit.some((a) => a.tool === 'add_note' && !a.ok && a.detail === 'scope'));
  assert.ok(!JSON.stringify(s.audit).includes('Сводка агента'));

  await db.pool.query("alter table mcp_audit add constraint reject_success_audit check (not ok) not valid");
  try {
    const blocked = await call(write.token, rpc('tools/call', { name: 'add_note', arguments: { title: 'Synthetic audit rollback', body: 'test' } }));
    assert.equal(blocked.json().result.isError, true);
    assert.equal((await db.pool.query("select id from notes where title='Synthetic audit rollback'")).rows.length, 0);
  } finally {
    await db.pool.query('alter table mcp_audit drop constraint reject_success_audit');
  }

  // revoke one token; switching off revokes the rest and hides the endpoint
  await app.inject({ method: 'DELETE', url: `/settings/mcp/tokens/${read.info.id}` });
  assert.equal((await call(read.token, rpc('ping'))).statusCode, 401);
  assert.equal((await call(write.token, rpc('ping'))).statusCode, 200);
  await app.inject({ method: 'PUT', url: '/settings/mcp', payload: { enabled: false } });
  assert.equal((await call(write.token, rpc('ping'))).statusCode, 404);
  await app.inject({ method: 'PUT', url: '/settings/mcp', payload: { enabled: true, acknowledged: true, password: PW } });
  assert.equal((await call(write.token, rpc('ping'))).statusCode, 401, 'old tokens do not come back after switching on again');
  // «Выйти везде» revokes the long-lived access too
  const again = (await app.inject({ method: 'POST', url: '/settings/mcp/tokens', payload: { name: 'ещё один', password: PW } })).json();
  assert.equal((await call(again.token, rpc('ping'))).statusCode, 200);
  const { revokeAllTokens } = await import('../../src/lib/mcpAccess.js');
  await revokeAllTokens(USER_ID);
  assert.equal((await call(again.token, rpc('ping'))).statusCode, 401);
});

test('the rate limit counts calls per token per minute', { skip: SKIP }, async () => {
  const { rateLimited } = await import('../../src/lib/mcpAccess.js');
  const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  let limited = false;
  for (let i = 0; i < 121; i++) limited = rateLimited('t-1', t0 + i);
  assert.equal(limited, true);
  assert.equal(rateLimited('t-1', t0 + 61_000), false, 'next minute starts over');
});
