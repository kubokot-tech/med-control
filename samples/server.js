/**
 * Receives anonymized samples of lab reports for the MedControl site: docs/LAB-PARSERS.md, «Образец бланка».
 * No dependencies on purpose: one small process on a separate cheap server. Each sample is one JSON file; nothing else is
 * kept, not even the sender's address (it stays in memory for an hour, for the rate limit). Sending is open, reading and
 * deleting need the token. Samples older than the retention period disappear on their own.
 *
 * Anybody can send, so a sample is untrusted text: whoever reads it later (a person in a terminal, an AI assistant
 * writing a parser) must treat it as data, never as instructions. What is checked here only keeps the text plain:
 * no control characters (terminal escape sequences), no endless lines.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = /^[a-f0-9]{24}$/;
const MAX_TEXT = 200_000;
const MAX_LINE = 2000; // a line of a lab report is a table row; anything longer is not a report
const MAX_CLIENTS = 10_000; // addresses remembered for the rate limit
const HOUR = 3_600_000;
// C0 and C1 control characters and DEL. A line feed and a tab are the two a report's text needs.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_IN_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const digest = (s) => createHash('sha256').update(String(s)).digest();
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

class TooLarge extends Error {}

/**
 * The body up to limit bytes. A larger one is read to its end and dropped, so the sender gets the answer instead of a
 * broken connection, but only up to four limits: past that the connection is cut.
 */
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit * 4) { req.destroy(); throw new TooLarge(); }
    if (size <= limit) chunks.push(c);
  }
  if (size > limit) throw new TooLarge();
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * { labName, text, appVersion } as sent by the gateway, or null. Line ends become plain line feeds; a control character
 * anywhere or a line past MAX_LINE refuses the whole sample (the gateway sends neither).
 */
export function validSample(body) {
  if (!body || typeof body !== 'object') return null;
  const labName = typeof body.labName === 'string' ? body.labName.trim() : '';
  const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n') : '';
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim() : '';
  if (!labName || labName.length > 200 || !text.trim() || text.length > MAX_TEXT || appVersion.length > 40) return null;
  if (CONTROL.test(labName) || CONTROL_IN_TEXT.test(text) || !/^[0-9A-Za-z.+_-]*$/.test(appVersion)) return null;
  if (text.split('\n').some((line) => line.length > MAX_LINE)) return null;
  return { labName, text, appVersion };
}

/**
 * The request handler and the expiry pass, separate from listening so that tests can drive them.
 * token: required, the service refuses to start without one. trustProxy: take the client from X-Forwarded-For (only behind
 * a reverse proxy that sets it, otherwise anyone could change their address and pass the rate limit).
 */
export function createSamplesService({ dir, token, retainDays = 180, perHour = 20, maxStored = 1000, maxClients = MAX_CLIENTS, trustProxy = false, now = Date.now }) {
  if (!token || token.length < 32) throw new Error('SAMPLES_TOKEN is required, at least 32 characters');
  const expected = digest(token);
  const hits = new Map();

  const file = (id) => path.join(dir, `${id}.json`);
  const ids = async () => (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const authorized = (req) => timingSafeEqual(digest((req.headers.authorization || '').replace(/^Bearer /, '')), expected);
  const client = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress || '';

  function limited(req) {
    const key = client(req);
    const t = now();
    const hit = hits.get(key);
    if (!hit || hit.until <= t) {
      // re-inserted, so the map stays ordered from the oldest hour to the newest
      hits.delete(key);
      if (hits.size >= maxClients) forget(t);
      hits.set(key, { n: 1, until: t + HOUR });
      return false;
    }
    hit.n += 1;
    return hit.n > perHour;
  }

  /**
   * The map of addresses must not grow without end while requests come from ever new addresses: past hours go first,
   * then the oldest ones still counting. Whoever has that many addresses is not held by a per-address limit anyway.
   */
  function forget(t) {
    for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size < maxClients) break; hits.delete(k); }
  }

  async function receive(req, res) {
    if (limited(req)) return json(res, 429, { error: 'too_many_requests' });
    let body;
    try { body = JSON.parse(await readBody(req, MAX_TEXT * 3)); }
    catch (e) { return json(res, e instanceof TooLarge ? 413 : 400, { error: e instanceof TooLarge ? 'too_large' : 'invalid_body' }); }
    const sample = validSample(body);
    if (!sample) return json(res, 400, { error: 'invalid_body' });
    if ((await ids()).length >= maxStored) return json(res, 503, { error: 'full' });
    const id = randomBytes(12).toString('hex');
    const tmp = path.join(dir, `.${id}.tmp`);
    await writeFile(tmp, JSON.stringify({ id, receivedAt: new Date(now()).toISOString(), ...sample }), { mode: 0o600 });
    await rename(tmp, file(id));
    return json(res, 201, { ok: true });
  }

  async function list(res) {
    const rows = [];
    for (const id of await ids()) {
      const { text, ...meta } = JSON.parse(await readFile(file(id), 'utf8'));
      rows.push({ ...meta, chars: text.length });
    }
    rows.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    return json(res, 200, { samples: rows });
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://samples');
    if (pathname === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
    if (pathname === '/api/samples' && req.method === 'POST') return receive(req, res);
    if (pathname !== '/api/samples' && !pathname.startsWith('/api/samples/')) return json(res, 404, { error: 'not_found' });
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
    if (pathname === '/api/samples') return req.method === 'GET' ? list(res) : json(res, 405, { error: 'method_not_allowed' });

    const id = pathname.slice('/api/samples/'.length);
    if (!ID.test(id)) return json(res, 404, { error: 'not_found' });
    try {
      if (req.method === 'GET') return json(res, 200, JSON.parse(await readFile(file(id), 'utf8')));
      if (req.method === 'DELETE') { await rm(file(id)); return json(res, 200, { ok: true }); }
    } catch (e) {
      if (e.code === 'ENOENT') return json(res, 404, { error: 'not_found' });
      throw e;
    }
    return json(res, 405, { error: 'method_not_allowed' });
  }

  /** Removes samples past the retention period and forgets the rate limit of past hours. */
  async function expire() {
    const edge = now() - retainDays * 24 * HOUR;
    let removed = 0;
    for (const id of await ids()) {
      if ((await stat(file(id))).mtimeMs < edge) { await rm(file(id), { force: true }); removed += 1; }
    }
    for (const [k, v] of hits) if (v.until <= now()) hits.delete(k);
    return removed;
  }

  const handler = (req, res) => handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: 'failed' }); else res.end(); });
  return { handler, expire, get clients() { return hits.size; } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.env.SAMPLES_DIR || '/data';
  await mkdir(dir, { recursive: true });
  const service = createSamplesService({
    dir, token: process.env.SAMPLES_TOKEN,
    retainDays: Number(process.env.SAMPLES_RETAIN_DAYS || 180),
    trustProxy: process.env.SAMPLES_TRUST_PROXY === '1',
  });
  await service.expire();
  setInterval(() => service.expire().catch(() => {}), HOUR).unref();
  const port = Number(process.env.PORT || 3900);
  createServer(service.handler).listen(port, () => console.log(`samples: listening on ${port}`));
}
