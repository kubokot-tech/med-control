import { NextRequest } from 'next/server';
import { bodyAllowance, PUBLIC_BODY_LIMIT } from '../../../../../shared/proxyGuard.js';

const INTERNAL_GATEWAY = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3000';
const MAX_BODY = 25 * 1024 * 1024;
// loading a "download all data" archive back: streamed through, never held in memory (gateway/src/routes/export.js)
const MAX_ARCHIVE = 2 * 1024 * 1024 * 1024 + 1024 * 1024;
// Desktop app: no edge in front, the browser talks to this server on 127.0.0.1 directly (docs/DESKTOP.md)
const DESKTOP = String(process.env.DTC_EDITION || '').toLowerCase() === 'desktop';

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Path segments arrive decoded: «health%3Fdeep=1» is one segment «health?deep=1». Joined as they are, they would turn
 * into another path or a query on the gateway and slip past the checks below. Refuse anything that is not a plain
 * segment, then encode each one again.
 */
function cleanPath(path: string[]): string[] | null {
  for (const seg of path) if (!seg || seg === '.' || seg === '..' || /[/\\?#\u0000-\u001f]/.test(seg)) return null;
  return path;
}

/** A desktop page must come from this very server: refuses DNS rebinding (another site's page on 127.0.0.1). */
function hostAllowed(req: NextRequest): boolean {
  if (!DESKTOP) return true;
  const port = process.env.PORT || '3001';
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.get('host') || '');
}

/** The body, read up to the limit whatever Content-Length says (chunked bodies have none). */
async function readBody(req: NextRequest, limit = MAX_BODY): Promise<ArrayBuffer | null> {
  if (Number(req.headers.get('content-length') || 0) > limit) return null;
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size); let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

/** The body passed on as a stream, cut off past `limit` (the gateway then sees a broken upload and refuses it). */
function limitedStream(req: NextRequest, limit: number): ReadableStream<Uint8Array> | null {
  if (Number(req.headers.get('content-length') || 0) > limit || !req.body) return null;
  let size = 0;
  return req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      size += chunk.byteLength;
      if (size > limit) ctl.error(new Error('too_large')); else ctl.enqueue(chunk);
    },
  }));
}

async function forward(req: NextRequest, ctx: Ctx, method: string, withBody: boolean) {
  const path = cleanPath((await ctx.params).path);
  if (!path) return json(400, { error: 'bad_path' });
  if (!hostAllowed(req)) return json(403, { error: 'forbidden' });
  // /health (and ?deep=1) is for the watchdog inside the stack, not for the internet; only Apple Health import/status pass
  if (path[0] === 'health' && !['import', 'status'].includes(path[1] || '')) return new Response('not found', { status: 404 });
  // edge asks the gateway about viewer requests directly (Caddy forward_auth); never through here
  if (path[0] === 'orthanc-auth') return new Response('not found', { status: 404 });
  // Nothing is held in memory for a request without credentials: 401 before the body is read, as the gateway would
  // answer after it. The public routes (sign-in, recovery, the wizard) get a small limit (shared/proxyGuard.js).
  const allowance = withBody ? bodyAllowance(path, req.headers.get('authorization')) : 'full';
  if (allowance === 'none') return json(401, { error: 'unauthorized' });
  const streamed = method === 'POST' && path.length === 2 && path[0] === 'import' && path[1] === 'archive';
  const body = !withBody ? null : streamed ? limitedStream(req, MAX_ARCHIVE) : await readBody(req, allowance === 'small' ? PUBLIC_BODY_LIMIT : MAX_BODY);
  if (withBody && body === null) return json(413, { error: 'too_large' });
  const contentType = req.headers.get('content-type') || undefined;
  const origin = req.headers.get('origin');
  // the client address: on the server edge (Caddy) has set X-Forwarded-For; on the desktop nobody has, so a page's own header is not trusted
  const forwardedFor = DESKTOP ? '127.0.0.1' : req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  const r = await fetch(`${INTERNAL_GATEWAY}/${path.map(encodeURIComponent).join('/')}${new URL(req.url).search}`, {
    method,
    headers: {
      ...(withBody && contentType ? { 'content-type': contentType } : {}),
      authorization: req.headers.get('authorization') || '',
      // the gateway refuses requests to the MCP endpoint from web pages of other sites: it needs to see their Origin
      ...(origin ? { origin } : {}),
      // Gateway logs the real client IP (trustProxy) and WebAuthn checks the origin.
      'x-forwarded-for': forwardedFor,
    },
    ...(withBody ? { body } : {}),
    ...(streamed ? { duplex: 'half' } : {}),
    cache: 'no-store',
    // a big archive over a slow line takes a while
    signal: AbortSignal.timeout(streamed ? 3_600_000 : 480_000),
  } as RequestInit);
  const out = await r.arrayBuffer();
  return new Response(out, { status: r.status, headers: r.headers });
}

// Next 15: route params arrive as a promise
type Ctx = { params: Promise<{ path: string[] }> };
export const GET = (req: NextRequest, ctx: Ctx) => forward(req, ctx, 'GET', false);
export const POST = (req: NextRequest, ctx: Ctx) => forward(req, ctx, 'POST', true);
export const PUT = (req: NextRequest, ctx: Ctx) => forward(req, ctx, 'PUT', true);
export const PATCH = (req: NextRequest, ctx: Ctx) => forward(req, ctx, 'PATCH', true);
export const DELETE = (req: NextRequest, ctx: Ctx) => forward(req, ctx, 'DELETE', true);
