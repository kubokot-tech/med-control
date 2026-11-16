import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db; let app;
const PW = 'correct horse battery';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');

before(async () => {
  if (SKIP) return;
  db = await setupDb('importarchive');
  const { CoreError, HTTP_STATUS, errorBody } = await import('../../src/lib/errors.js');
  app = Fastify();
  await app.register(multipart);
  app.decorate('authenticate', async (req) => { req.user = { sub: USER_ID, tz: 'Europe/Moscow' }; });
  app.setErrorHandler((err, _req, reply) => (err instanceof CoreError ? reply.code(HTTP_STATUS[err.kind]).send(errorBody(err)) : reply.code(500).send({ error: 'internal', m: err.message })));
  await app.register((await import('../../src/routes/export.js')).default);
  await (await import('../../src/lib/setup.js')).completeSetup({ password: PW });
});
after(async () => { if (app) await app.close(); if (db) await db.teardown(); });

/** multipart body: the password field, then the archive file */
function form(zip, password = PW) {
  const b = '----medcontroltest';
  const parts = [
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="password"\r\n\r\n${password}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="archive"; filename="export.zip"\r\nContent-Type: application/zip\r\n\r\n`),
    zip, Buffer.from(`\r\n--${b}--\r\n`),
  ];
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

test('an exported archive loads back into an empty installation: data, files at the new place, settings; never twice', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { createContact } = await import('../../src/lib/contacts.js');
  const { createMilestone, attachToMilestone } = await import('../../src/lib/milestones.js');
  const { setSetting } = await import('../../src/lib/settings.js');
  const { setProtocol, protocolFromPreset } = await import('../../src/lib/protocol.js');
  await commitManual(USER_ID, { date: '2026-02-01', rows: [{ key: 'ALT', value: '52' }, { key: 'CRP', value: '<0,6' }] }, { tz: 'Europe/Moscow' });
  await createContact(USER_ID, { name: 'Онколог', phones: ['+7 000 000-00-01'] });
  const m = await createMilestone(USER_ID, { date: '2026-01-20', kind: 'histology', title: 'Биопсия' });
  const att = await attachToMilestone(USER_ID, m.id, { buf: PNG, mime: 'image/png', filename: 'скан.png' }, { log: db.quiet });
  await setSetting('anamnesis', 'Диагноз: пример.');
  await setProtocol(protocolFromPreset('hemodialysis'));
  await db.pool.query(`update users set sex = 'f', prefs = '{"region":"DE"}'::jsonb where id = $1`, [USER_ID]);

  // a non-empty installation refuses
  const res = await app.inject({ method: 'GET', url: '/export/all.zip' });
  assert.equal(res.statusCode, 200);
  const zip = res.rawPayload;
  const refused = await app.inject({ method: 'POST', url: '/import/archive', ...form(zip) });
  assert.equal(refused.json().error, 'import_not_empty');

  // empty it like a fresh installation (and a different data folder, as when moving to the desktop app)
  const tables = (await db.pool.query(`select tablename from pg_tables where schemaname = 'public' and tablename not in ('schema_migrations', 'lab_catalog', 'users', 'app_settings')`)).rows.map((r) => r.tablename);
  await db.pool.query(`truncate ${tables.map((t) => `"${t}"`).join(', ')} cascade`);
  await db.pool.query(`delete from app_settings where key in ('anamnesis', 'treatment_protocol')`);
  await db.pool.query(`update users set sex = null, prefs = '{}'::jsonb where id = $1`, [USER_ID]);
  const oldDir = process.env.DTC_DATA_DIR;
  process.env.DTC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dtc-import-'));
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/import/status' })).json().empty, true);
    assert.equal((await app.inject({ method: 'POST', url: '/import/archive', ...form(zip, 'wrong') })).statusCode, 403, 'password required');
    const ok = await app.inject({ method: 'POST', url: '/import/archive', ...form(zip) });
    assert.equal(ok.statusCode, 200, ok.body);
    const r = ok.json();
    assert.ok(r.tables.lab_results === 2 && r.tables.contacts === 1 && r.tables.milestones === 1, JSON.stringify(r.tables));
    assert.ok(r.files >= 1);

    const crp = await db.pool.query(`select r.value_text from lab_results r join lab_tests t on t.id = r.test_id where t.canonical_key = 'CRP'`);
    assert.equal(crp.rows[0].value_text, '<0,6');
    const a = await db.pool.query('select file_url from attachments where sha256 = $1', [att.sha256]);
    assert.ok(a.rows[0].file_url.startsWith(process.env.DTC_DATA_DIR), 'the file path points into the new data folder');
    assert.ok(existsSync(a.rows[0].file_url), 'and the file is there');
    const s = await db.pool.query(`select key, value from app_settings where key in ('anamnesis', 'treatment_protocol')`);
    assert.equal(s.rows.length, 2);
    assert.equal(JSON.parse(s.rows.find((x) => x.key === 'treatment_protocol').value).preset, 'hemodialysis');
    const u = await db.pool.query('select sex, prefs from users where id = $1', [USER_ID]);
    assert.deepEqual([u.rows[0].sex, u.rows[0].prefs.region], ['f', 'DE']);
    const { checkPassword } = await import('../../src/lib/setup.js');
    assert.equal(checkPassword(PW), true, 'sign-in of this installation unchanged');

    // a second load is refused: the installation is in use now
    assert.equal((await app.inject({ method: 'POST', url: '/import/archive', ...form(zip) })).json().error, 'import_not_empty');
    assert.deepEqual(readdirSync(path.join(process.env.DTC_DATA_DIR, 'tmp')), [], 'no temporary archive left behind');
  } finally {
    rmSync(process.env.DTC_DATA_DIR, { recursive: true, force: true });
    process.env.DTC_DATA_DIR = oldDir;
  }
});

test('something that is not our export is refused', { skip: SKIP }, async () => {
  const { importArchive } = await import('../../src/lib/importArchive.js');
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'dtc-bad-')), 'x.zip');
  writeFileSync(p, Buffer.from('not a zip'));
  await assert.rejects(importArchive(USER_ID, p), (e) => e.code === 'import_bad_archive');
});

/** A zip from { name: content } (Buffer or object for JSON). */
async function makeZip(files) {
  const archiver = (await import('archiver')).default;
  const a = archiver('zip');
  const chunks = [];
  a.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => { a.on('end', res); a.on('error', rej); });
  for (const [name, v] of Object.entries(files)) a.append(Buffer.isBuffer(v) ? v : JSON.stringify(v), { name });
  await a.finalize(); await done;
  return Buffer.concat(chunks);
}
async function emptyInstall() {
  const tables = (await db.pool.query(`select tablename from pg_tables where schemaname = 'public' and tablename not in ('schema_migrations', 'lab_catalog', 'users', 'app_settings')`)).rows.map((r) => r.tablename);
  await db.pool.query(`truncate ${tables.map((t) => `"${t}"`).join(', ')} cascade`);
}

test('catalog rows the new installation already made (infusion catalog, lab test codes) are matched, not a failure', { skip: SKIP }, async () => {
  await emptyInstall();
  const inf = await import('../../src/lib/infusions.js');
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const agent = await inf.createAgent(USER_ID, { name: 'Золедроновая кислота' });
  await inf.createInfusion(USER_ID, { agentId: agent.id, date: '2026-02-01' });
  await commitManual(USER_ID, { date: '2026-02-01', rows: [{ key: 'ALT', value: '52' }] }, { tz: 'Europe/Moscow' });
  const zip = (await app.inject({ method: 'GET', url: '/export/all.zip' })).rawPayload;
  await emptyInstall();
  await inf.createAgent(USER_ID, { name: 'Золедроновая кислота' }); // the new installation seeded its catalog: same name, new id
  await commitManual(USER_ID, { date: '2026-01-01', rows: [{ key: 'ALT', value: '40' }] }, { tz: 'Europe/Moscow' });
  await db.pool.query('delete from lab_results'); await db.pool.query('delete from ingest_observations_raw'); await db.pool.query('delete from ingest_documents'); await db.pool.query('delete from events');
  const r = await app.inject({ method: 'POST', url: '/import/archive', ...form(zip) });
  assert.equal(r.statusCode, 200, r.body);
  const s = await db.pool.query('select count(*)::int c from infusion_sessions s join infusion_agents a on a.id = s.agent_id');
  assert.equal(s.rows[0].c, 1, 'the session points at the catalog row that was already there');
  const l = await db.pool.query(`select count(*)::int c from lab_results r join lab_tests t on t.id = r.test_id where t.canonical_key = 'ALT'`);
  assert.equal(l.rows[0].c, 1);
});

test('a file path outside the uploads is dropped; a Windows path from the desktop app is moved to this data folder', { skip: SKIP }, async () => {
  await emptyInstall();
  const { importArchive } = await import('../../src/lib/importArchive.js');
  const ev = '11111111-1111-1111-1111-111111111111';
  const sha1 = 'a'.repeat(64); const sha2 = 'b'.repeat(64);
  const zip = await makeZip({
    'manifest.json': { app: 'MedControl' },
    'tables/events.json': [{ id: ev, user_id: USER_ID, type: 'NOTE', occurred_at: '2026-02-01T10:00:00Z', title: 'x' }],
    'tables/attachments.json': [
      { id: '22222222-2222-2222-2222-222222222222', user_id: USER_ID, event_id: ev, sha256: sha1, filename: 'secret', mime_type: 'text/plain', file_url: '/proc/self/environ' },
      { id: '33333333-3333-3333-3333-333333333333', user_id: USER_ID, event_id: ev, sha256: sha2, filename: 'scan.png', mime_type: 'image/png', file_url: `C:\\Users\\me\\AppData\\MedControl\\uploads\\milestones\\${sha2}.png` },
    ],
    [`files/milestones/${sha2}.png`]: PNG,
  });
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'dtc-zip-')), 'a.zip');
  writeFileSync(p, zip);
  const out = await importArchive(USER_ID, p, { log: db.quiet });
  assert.equal(out.tables.attachments, 1, 'the doctored row is not loaded');
  const rows = await db.pool.query('select sha256, file_url from attachments');
  assert.equal(rows.rows.length, 1);
  assert.ok(rows.rows[0].file_url.startsWith(process.env.DTC_DATA_DIR) && rows.rows[0].file_url.endsWith(`/uploads/milestones/${sha2}.png`), rows.rows[0].file_url);
  assert.ok(existsSync(rows.rows[0].file_url));
});

test('the file type of an archive is not taken on trust: only upload types are served as themselves, the rest is a download', { skip: SKIP }, async () => {
  await emptyInstall();
  const { importArchive } = await import('../../src/lib/importArchive.js');
  const ev = '44444444-4444-4444-4444-444444444444';
  const sha = (c) => c.repeat(64);
  const page = Buffer.from('<!doctype html><script>fetch("/api/gateway/export/all.zip")</script>');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  const row = (n, hash, filename, mime, ext) => ({ id: `55555555-5555-5555-5555-55555555555${n}`, user_id: USER_ID, event_id: ev, sha256: hash, filename, mime_type: mime, file_url: `/data/uploads/milestones/${hash}.${ext}` });
  const zip = await makeZip({
    'manifest.json': { app: 'MedControl' },
    'tables/events.json': [{ id: ev, user_id: USER_ID, type: 'NOTE', occurred_at: '2026-02-01T10:00:00Z', title: 'x' }],
    'tables/attachments.json': [
      row(1, sha('c'), 'выписка.html', 'text/html', 'html'),
      row(2, sha('d'), 'scan.svg', 'image/svg+xml', 'svg'),
      row(3, sha('e'), 'scan.png', 'image/png', 'png'),
      row(4, sha('f'), 'report.pdf', 'application/pdf; charset=evil', 'pdf'),
      row(5, sha('0'), 'nothing', null, 'bin'),
    ],
    [`files/milestones/${sha('c')}.html`]: page,
    [`files/milestones/${sha('d')}.svg`]: svg,
    [`files/milestones/${sha('e')}.png`]: PNG,
    [`files/milestones/${sha('f')}.pdf`]: Buffer.from('%PDF-1.4'),
    [`files/milestones/${sha('0')}.bin`]: Buffer.from('x'),
  });
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'dtc-zip-')), 'm.zip');
  writeFileSync(p, zip);
  const out = await importArchive(USER_ID, p, { log: db.quiet });
  assert.equal(out.tables.attachments, 5);
  const stored = Object.fromEntries((await db.pool.query('select filename, mime_type from attachments')).rows.map((r) => [r.filename, r.mime_type]));
  assert.deepEqual(stored, {
    'выписка.html': 'application/octet-stream', 'scan.svg': 'application/octet-stream', 'scan.png': 'image/png',
    'report.pdf': 'application/octet-stream', nothing: 'application/octet-stream',
  }, 'normalised on the way in');

  const web = Fastify();
  web.decorate('authenticate', async (req) => { req.user = { sub: USER_ID, tz: 'Europe/Moscow' }; });
  await web.register((await import('../../src/routes/attachments.js')).default);
  try {
    const get = (hash, inline = true) => web.inject({ method: 'GET', url: `/attachments/${hash}${inline ? '?inline=1' : ''}` });
    const html = await get(sha('c'));
    assert.equal(html.statusCode, 200);
    assert.equal(html.headers['content-type'], 'application/octet-stream', 'a page from the archive never runs on our address');
    assert.match(html.headers['content-disposition'], /^attachment;/, 'even when the viewer asks for inline');
    assert.equal(html.headers['x-content-type-options'], 'nosniff');
    assert.equal(html.rawPayload.toString(), page.toString(), 'the file itself is untouched');
    const picture = await get(sha('e'));
    assert.deepEqual([picture.headers['content-type'], picture.headers['x-content-type-options']], ['image/png', 'nosniff']);
    assert.match(picture.headers['content-disposition'], /^inline;/, 'a picture still opens in the page');
    assert.match((await get(sha('e'), false)).headers['content-disposition'], /^attachment;/);

    // a row written by an import before this check (or by hand) is served the same way
    await db.pool.query(`update attachments set mime_type = 'image/svg+xml' where sha256 = $1`, [sha('d')]);
    const old = await get(sha('d'));
    assert.equal(old.headers['content-type'], 'application/octet-stream');
    assert.match(old.headers['content-disposition'], /^attachment;/);
    await db.pool.query(`update attachments set mime_type = 'text/html' where sha256 = $1`, [sha('c')]);
    assert.equal((await get(sha('c'))).headers['content-type'], 'application/octet-stream');
  } finally { await web.close(); }
});
