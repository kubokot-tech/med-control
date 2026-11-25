// The gateway inside the page: the same app as gateway/src/server.js, minus the HTTP server, signals and the
// Telegram bot. Requests come through app.inject() (light-my-request) instead of a socket.
import './env.js';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import Fastify from 'fastify';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// pdf.js otherwise loads its worker with a dynamic import. WKWebView on iPad never finishes that import, so parsing a PDF never returns.
globalThis.pdfjsWorker = { WorkerMessageHandler };
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { hydrate } from './shims/fs.js';
import { pool } from '../../gateway/src/lib/db.js';
import { runMigrations } from '../../gateway/src/lib/migrate.js';
import { loadCatalog } from '../../gateway/src/lib/canonical.js';
import { loadSettings } from '../../gateway/src/lib/settings.js';
import { prepareSetupCode } from '../../gateway/src/lib/setupCode.js';
import { setupNeeded } from '../../gateway/src/lib/setup.js';
import { sweepPending } from '../../gateway/src/lib/labsCommit.js';
import authRoutes, { ensureUser, authenticate } from '../../gateway/src/lib/auth.js';
import { resolveJwtSecret } from '../../gateway/src/lib/config.js';
import { CoreError, HTTP_STATUS, errorBody } from '../../gateway/src/lib/errors.js';
import labsRoutes from '../../gateway/src/routes/labs.js';
import labsExportRoutes from '../../gateway/src/routes/labsExport.js';
import labSampleRoutes from '../../gateway/src/routes/labSample.js';
import attachmentsRoutes from '../../gateway/src/routes/attachments.js';
import medsRoutes from '../../gateway/src/routes/meds.js';
import timelineRoutes from '../../gateway/src/routes/timeline.js';
import symptomsRoutes from '../../gateway/src/routes/symptoms.js';
import alertsRoutes from '../../gateway/src/routes/alerts.js';
import milestonesRoutes from '../../gateway/src/routes/milestones.js';
import imagingRoutes from '../../gateway/src/routes/imaging.js';
import notifyRoutes from '../../gateway/src/routes/notify.js';
import reportRoutes from '../../gateway/src/routes/report.js';
import aiRoutes from '../../gateway/src/routes/ai.js';
import appointmentsRoutes from '../../gateway/src/routes/appointments.js';
import infusionsRoutes from '../../gateway/src/routes/infusions.js';
import exportRoutes from '../../gateway/src/routes/export.js';
import notesRoutes from '../../gateway/src/routes/notes.js';
import healthRoutes from '../../gateway/src/routes/health.js';
import searchRoutes from '../../gateway/src/routes/search.js';
import protocolRoutes from '../../gateway/src/routes/protocol.js';
import setupRoutes from '../../gateway/src/routes/setup.js';
import localeRoutes from '../../gateway/src/routes/locale.js';
import labRefsRoutes from '../../gateway/src/routes/labRefs.js';
import contactsRoutes from '../../gateway/src/routes/contacts.js';
import mcpRoutes from '../../gateway/src/routes/mcp.js';
import patientRoutes from '../../gateway/src/routes/patient.js';
import homeRoutes from '../../gateway/src/routes/home.js';
import { edition, platform } from '../../gateway/src/lib/edition.js';
import { nextDoseDay } from '../../gateway/src/lib/schedule.js';
import { startScheduler } from '../../gateway/src/lib/scheduler.js';
import { HARDCODED_USER_ID, passwordConfirmed } from '../../gateway/src/lib/auth.js';
import { commitLabsPdf, commitPdfFailure } from '../../gateway/src/lib/labsCommit.js';
import { createMilestonesBatch, attachToMilestone } from '../../gateway/src/lib/milestones.js';
import { detectMime, safeMime, storeAttachment } from '../../gateway/src/lib/attachmentsStore.js';
import { createNote, parseMarkdownImport } from '../../gateway/src/lib/notes.js';
import { attachReport } from '../../gateway/src/lib/appointments.js';
import { userLanguage } from '../../gateway/src/lib/userLocale.js';
import { anamnesisFromFile } from '../../gateway/src/lib/anamnesisFile.js';
import { labSampleFromPdf } from '../../gateway/src/lib/labSample.js';
import { importArchive } from '../../gateway/src/lib/importArchive.js';
import { autoExtract } from '../../gateway/src/lib/extracts.js';
import * as fileStore from '../../gateway/src/lib/files.js';
import { writeDatabaseCopy } from './container.js';
import { gate } from './gate.js';
import { UUID_RX } from '../../gateway/src/lib/labsQuery.js';
import { DEFAULT_TZ, isValidTz } from '../../gateway/src/lib/dates.js';
import { BatchMeta } from '../../gateway/src/routes/milestones.js';

const t0 = performance.now();
const marks = [];
const mark = (name) => marks.push([name, Math.round(performance.now() - t0)]);

// One file limit for both paths: multipart through inject and the direct calls below (the routes use the same).
const FILE_MAX = 20 * 1024 * 1024;

/** A server object for Fastify that never listens: inject() needs none. */
function fakeServer(handler) {
  const s = new EventEmitter();
  s.handler = handler;
  s.listen = (...a) => { const cb = a.find((x) => typeof x === 'function'); cb?.(); return s; };
  s.close = (cb) => { cb?.(); return s; };
  s.address = () => ({ address: '127.0.0.1', port: 0, family: 'IPv4' });
  s.setTimeout = () => s;
  s.keepAliveTimeout = 0; s.requestTimeout = 0; s.headersTimeout = 0;
  return s;
}

/** A pino-shaped logger on the console (pino's browser build lacks what Fastify needs). */
function consoleLogger(bindings = {}) {
  const at = (fn) => (o, msg) => { if (typeof o === 'string') fn('[gateway]', o); else fn('[gateway]', msg || '', o); };
  return {
    level: 'warn', bindings: () => bindings,
    fatal: at(console.error), error: at(console.error), warn: at(console.warn),
    info() {}, debug() {}, trace() {}, silent() {},
    child(b) { return consoleLogger({ ...bindings, ...b }); },
  };
}

async function boot() {
  const restored = await hydrate();
  mark(`files ${restored}`);
  // No logger: any logger option loads pino, whose browser build lacks what Fastify needs. Errors go to the console below.
  const app = Fastify({ serverFactory: fakeServer });
  await app.register(jwt, { secret: resolveJwtSecret() });
  await app.register(multipart, { limits: { fileSize: FILE_MAX, files: 50, fields: 10, fieldSize: 256 * 1024 } });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof CoreError) return reply.code(HTTP_STATUS[err.kind] || 400).send(errorBody(err));
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) { console.error('[gateway] unhandled', err); return reply.code(500).send({ error: 'internal', message: String(err?.message || err) }); }
    return reply.code(status).send({ error: err.code || 'error', message: err.message });
  });
  mark('fastify');
  await pool.query('select 1');
  mark('pglite open');
  await runMigrations(pool, process.env.MIGRATIONS_DIR, app.log);
  mark('migrations');
  await loadCatalog(pool); mark('catalog');
  await loadSettings(); mark('settings');
  await ensureUser(); mark('user');
  prepareSetupCode(setupNeeded(), app.log);
  await sweepPending(7, app.log);
  mark('init');
  app.decorate('authenticate', authenticate);
  app.get('/health', async () => ({ ok: true, edition: edition() }));
  const routes = { authRoutes, labsRoutes, labsExportRoutes, labSampleRoutes, attachmentsRoutes, medsRoutes, timelineRoutes,
    symptomsRoutes, alertsRoutes, milestonesRoutes, imagingRoutes, notifyRoutes, reportRoutes, aiRoutes, appointmentsRoutes,
    infusionsRoutes, exportRoutes, notesRoutes, healthRoutes, searchRoutes, protocolRoutes, setupRoutes, localeRoutes, labRefsRoutes,
    contactsRoutes, mcpRoutes, patientRoutes, homeRoutes };
  for (const [name, r] of Object.entries(routes)) { await app.register(r); await app.after(); mark(name); }
  await app.ready();
  mark('routes');
  // Desktop keeps the in-page ticker (it sends Telegram while the window is open). On iPad the system
  // delivers reminders, so this ticker must not run.
  if (platform() !== 'ipad') startScheduler({ pool, userId: HARDCODED_USER_ID, log: app.log });
  scheduleDatabaseCopy();
  return app;
}

// IndexedDB holds the live database. A copy in the app folder is what survives if iPad clears the browser storage.
// dirty: a write happened since the last copy. dumpDataDir holds the PGlite mutex, so copying without changes
// would only freeze the interface for nothing.
let dirty = true;
function scheduleDatabaseCopy() {
  if (!globalThis.__TAURI_INTERNALS__ || !pool.db || typeof pool.db.dumpDataDir !== 'function') return;
  let running = false;
  const copy = () => gate(async () => {
    if (running || !dirty) return;
    // An unfinished setup means an empty database: writing it over the container copy would destroy
    // the only remaining history. Same when a stored copy failed to open or could not be read (the flag).
    if (setupNeeded() || globalThis.__MC_RESTORE_FAILED) return;
    running = true;
    try {
      const blob = await pool.db.dumpDataDir();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength > 1024) { await writeDatabaseCopy(bytes); dirty = false; }
    } catch (e) { console.warn('[medcontrol] database copy failed', e); }
    finally { running = false; }
  });
  setTimeout(copy, 8000);
  setInterval(copy, 120000);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) copy(); });
  }
}

const ready = boot();

const json = (status, body) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
const toBuf = (bytes) => bytes instanceof Uint8Array && !Buffer.isBuffer(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes || []);
const caught = (e) => {
  if (e instanceof CoreError) return json(HTTP_STATUS[e.kind] || 400, errorBody(e));
  console.error('[gateway]', e);
  return json(500, { error: 'internal', message: String(e?.message || e) });
};

async function ownerTz() {
  const u = await pool.query('select timezone from users where id=$1', [HARDCODED_USER_ID]);
  const tz = u.rows[0]?.timezone;
  return isValidTz(tz) ? tz : DEFAULT_TZ;
}

// The upload screen already holds the bytes. Feeding them through multipart (app.inject) never finishes on the
// device: the handler starts and then waits on the file stream. Call the same commit the route calls.
async function commitPdf({ filename, bytes } = {}) {
  await ready;
  const buf = bytes instanceof Uint8Array && !Buffer.isBuffer(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes || []);
  if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
  try {
    const r = await commitLabsPdf({ userId: HARDCODED_USER_ID, buf, filename: filename || 'file.pdf' });
    if (r.needsReview) return json(200, { ok: false, needsReview: true, sha256: r.sha256, draft: r.draft });
    return json(200, { ok: true, sha256: r.sha256, inserted: r.inserted, already: r.already, eventId: r.eventId, alertsRaised: r.alertsRaised, labName: r.labName, docDate: r.docDate });
  } catch (e) {
    const f = commitPdfFailure(e);
    if (f) return json(f.status, f.body);
    console.error('[gateway] commit-pdf', e);
    return json(500, { error: 'internal', message: String(e?.message || e) });
  }
}

// Same as the milestones routes, without multipart: on the device that parser accepts the request and then waits.
async function milestoneBatch({ meta, files } = {}) {
  await ready;
  const parsed = BatchMeta.safeParse(meta);
  if (!parsed.success) return json(400, { error: 'invalid_meta', details: parsed.error.issues });
  const list = Array.isArray(files) ? files : [];
  if (parsed.data.length !== list.length) return json(400, { error: 'meta_files_mismatch', meta: parsed.data.length, files: list.length });
  const items = [];
  for (const [i, file] of list.entries()) {
    const buf = toBuf(file.bytes);
    if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
    items.push({ meta: parsed.data[i], file: { filename: file.filename, mimetype: file.type, buf } });
  }
  try {
    return json(200, await createMilestonesBatch(HARDCODED_USER_ID, items, { tz: await ownerTz(), log: console }));
  } catch (e) { return caught(e); }
}

async function milestoneAttach({ id, filename, type, bytes } = {}) {
  await ready;
  if (!UUID_RX.test(String(id || ''))) return json(400, { error: 'bad_id' });
  const buf = toBuf(bytes);
  if (!buf.length) return json(400, { error: 'file_required' });
  if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
  const mime = detectMime(type, filename);
  if (!mime) return json(415, { error: 'unsupported_type', mime: type || null });
  try {
    return json(200, { ok: true, attachment: await attachToMilestone(HARDCODED_USER_ID, id, { buf, mime, filename }, { log: console }) });
  } catch (e) { return caught(e); }
}

// Same bytes as GET /attachments/:sha, read straight from the store. A file stream through app.inject
// is the path that already fails to finish on the device, and the page only needs the bytes.
async function attachmentGet({ sha256, inline } = {}) {
  await ready;
  const sha = String(sha256 || '');
  if (!/^[a-f0-9]{64}$/i.test(sha)) return json(400, { error: 'bad_sha256' });
  const r = await pool.query(
    'select file_url, mime_type, filename from attachments where user_id=$1 and sha256=$2 limit 1',
    [HARDCODED_USER_ID, sha]
  );
  if (!r.rows.length) return json(404, { error: 'not_found' });
  const row = r.rows[0];
  const mime = safeMime(row.mime_type);
  if (!(await fileStore.exists(row.file_url))) return json(404, { error: 'file_missing' });
  const buf = await fileStore.read(row.file_url);
  const ext = mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? mime.split('/')[1].replace('jpeg', 'jpg') : 'bin';
  const name = row.filename || `${sha.slice(0, 12)}.${ext}`;
  const show = !!inline && mime !== 'application/octet-stream';
  return {
    status: 200,
    headers: {
      'content-type': mime,
      'x-content-type-options': 'nosniff',
      'content-disposition': `${show ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
    body: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  };
}

async function confirmPassword(password) {
  const reply = { status: 200, code(s) { this.status = s; return this; }, send(body) { this.body = body; return this; } };
  const ok = await passwordConfirmed({ ip: '127.0.0.1', body: { password } }, reply);
  return ok ? null : json(reply.status || 403, reply.body || { error: 'invalid_password' });
}

// Notes, a visit report, the anamnesis document and the data archive. Same as their routes, without multipart.
async function notesImport({ files } = {}) {
  await ready;
  const created = []; const skipped = [];
  const tz = await ownerTz();
  for (const file of Array.isArray(files) ? files : []) {
    const name = file.filename || 'import.md';
    if (!/\.(md|markdown|txt)$/i.test(name)) { skipped.push({ name, reason: 'not_markdown' }); continue; }
    const buf = toBuf(file.bytes);
    if (!buf.length || buf.length > 2_000_000) { skipped.push({ name, reason: buf.length ? 'too_big' : 'empty' }); continue; }
    const parsed = parseMarkdownImport(buf.toString('utf8'), name);
    const n = await createNote(HARDCODED_USER_ID, parsed, { tz, source: 'import', sourceName: parsed.sourceName || name });
    created.push({ id: n.id, title: n.title });
  }
  if (!created.length && !skipped.length) return json(400, { error: 'file_required' });
  return json(200, { ok: true, created, skipped });
}

async function noteFiles({ id, files } = {}) {
  await ready;
  if (!UUID_RX.test(String(id || ''))) return json(400, { error: 'bad_id' });
  const cur = await pool.query('select event_id from notes where user_id = $1 and id = $2', [HARDCODED_USER_ID, id]);
  if (!cur.rows.length || !cur.rows[0].event_id) return json(404, { error: 'not_found' });
  const out = [];
  for (const file of Array.isArray(files) ? files : []) {
    const buf = toBuf(file.bytes);
    if (!buf.length) continue;
    if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
    const mime = detectMime(file.type, file.filename);
    if (!mime) return json(415, { error: 'unsupported_type', mime: file.type || null });
    out.push(await storeAttachment(pool, HARDCODED_USER_ID, cur.rows[0].event_id, buf, mime, file.filename));
  }
  if (!out.length) return json(400, { error: 'file_required' });
  await pool.query('update notes set updated_at = now() where id = $1', [id]);
  try { await autoExtract(HARDCODED_USER_ID, out, console); } catch (e) { return caught(e); }
  return json(200, { ok: true, files: out });
}

async function appointmentReport({ id, summary, files } = {}) {
  await ready;
  if (!UUID_RX.test(String(id || ''))) return json(400, { error: 'bad_id' });
  const packed = [];
  for (const file of Array.isArray(files) ? files : []) {
    const buf = toBuf(file.bytes);
    if (!buf.length) continue;
    if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
    const mime = detectMime(file.type, file.filename);
    if (mime) packed.push({ buf, mime, filename: file.filename });
  }
  try {
    const r = await attachReport(HARDCODED_USER_ID, id, { files: packed, summary: String(summary || '').slice(0, 4000), tz: await ownerTz() });
    return r ? json(200, { ok: true, ...r }) : json(404, { error: 'not_found' });
  } catch (e) { return caught(e); }
}

async function anamnesisExtract({ filename, bytes } = {}) {
  await ready;
  const buf = toBuf(bytes);
  if (!buf.length) return json(400, { error: 'empty_file' });
  if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
  try {
    return json(200, await anamnesisFromFile(buf, filename, { language: await userLanguage(HARDCODED_USER_ID) }));
  } catch (e) {
    if (['unsupported_file', 'no_text_in_file', 'ocr_failed', 'ingestion_failed'].includes(e.code)) return json(422, { error: e.code });
    return caught(e);
  }
}

async function labSample({ bytes } = {}) {
  await ready;
  const buf = toBuf(bytes);
  if (!buf.length) return json(400, { error: 'file_required' });
  if (buf.length > FILE_MAX) return json(413, { error: 'too_large' });
  try {
    return json(200, await labSampleFromPdf(buf));
  } catch (e) {
    if (e.code === 'not_pdf') return json(415, { error: 'not_pdf' });
    if (e.code === 'sample_no_text') return json(422, { error: 'sample_no_text' });
    return caught(e);
  }
}

async function importArchiveFile({ password, bytes } = {}) {
  await ready;
  if (!password) return json(400, { error: 'invalid_password' });
  const denied = await confirmPassword(password);
  if (denied) return denied;
  const buf = toBuf(bytes);
  if (!buf.length) return json(400, { error: 'file_required' });
  if (buf.length > 2 * 1024 ** 3) return json(413, { error: 'too_large' });
  const ref = await fileStore.put('tmp', `import-${Date.now()}.zip`, buf);
  try {
    return json(200, { ok: true, ...(await importArchive(HARDCODED_USER_ID, ref, { log: console })) });
  } catch (e) { return caught(e); }
  finally { await fileStore.remove(ref).catch(() => {}); }
}

/** One API call: { method, url, headers, body } → { status, headers, body } (body as text, or bytes for binary). */
async function request({ method = 'GET', url, headers = {}, body } = {}) {
  const app = await ready;
  // light-my-request takes a Buffer, a string or a stream; anything else it serialises as JSON
  const payload = body instanceof Uint8Array && !Buffer.isBuffer(body) ? Buffer.from(body.buffer, body.byteOffset, body.byteLength) : body;
  const res = await app.inject({ method, url, headers, payload });
  const type = String(res.headers['content-type'] || '');
  const mime = type.split(';', 1)[0].trim().toLowerCase();
  const text = !mime || mime.startsWith('text/') || /^application\/(?:json|xml|javascript|[^/]+\+(?:json|xml))$/.test(mime);
  return { status: res.statusCode, headers: res.headers, body: text ? res.payload : new Uint8Array(res.rawPayload) };
}

// Serialized: the transaction slot is global, so a second call must wait until the first has committed.
// Every call that can write marks the database copy stale; reads (GET/HEAD through request) do not.
const queued = (fn, readsOnly = false) => (...args) => gate(() => {
  if (!readsOnly || !['GET', 'HEAD'].includes(String(args[0]?.method || 'GET').toUpperCase())) dirty = true;
  return fn(...args);
});
globalThis.mcGateway = {
  ready: ready.then(() => marks), nextDoseDay,
  request: queued(request, true), commitPdf: queued(commitPdf), milestoneBatch: queued(milestoneBatch),
  milestoneAttach: queued(milestoneAttach), attachmentGet: queued(attachmentGet), notesImport: queued(notesImport),
  noteFiles: queued(noteFiles), appointmentReport: queued(appointmentReport), anamnesisExtract: queued(anamnesisExtract),
  labSample: queued(labSample), importArchiveFile: queued(importArchiveFile),
};
