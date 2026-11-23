// First: the desktop edition fills its environment defaults before other modules read them.
import './lib/desktopEnv.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/db.js';
import { available, edition } from './lib/edition.js';
import { desktopHostGuard } from './lib/hostGuard.js';
import { runMigrations } from './lib/migrate.js';
import { loadCatalog, recanonicalize } from './lib/canonical.js';
import { loadSettings } from './lib/settings.js';
import { prepareSetupCode } from './lib/setupCode.js';
import { setupNeeded, ENV_PASSWORD_WARNING } from './lib/setup.js';
import { renormalizeUnits } from './lib/units.js';
import { sweepPending } from './lib/labsCommit.js';
import authRoutes, { ensureUser, authenticate } from './lib/auth.js';
import labsRoutes from './routes/labs.js';
import labsExportRoutes from './routes/labsExport.js';
import labSampleRoutes from './routes/labSample.js';
import attachmentsRoutes from './routes/attachments.js';
import medsRoutes from './routes/meds.js';
import timelineRoutes from './routes/timeline.js';
import symptomsRoutes from './routes/symptoms.js';
import alertsRoutes from './routes/alerts.js';
import milestonesRoutes from './routes/milestones.js';
import imagingRoutes from './routes/imaging.js';
import notifyRoutes from './routes/notify.js';
import reportRoutes from './routes/report.js';
import aiRoutes from './routes/ai.js';
import appointmentsRoutes from './routes/appointments.js';
import infusionsRoutes from './routes/infusions.js';
import exportRoutes from './routes/export.js';
import notesRoutes from './routes/notes.js';
import healthRoutes from './routes/health.js';
import searchRoutes from './routes/search.js';
import protocolRoutes from './routes/protocol.js';
import setupRoutes from './routes/setup.js';
import localeRoutes from './routes/locale.js';
import labRefsRoutes from './routes/labRefs.js';
import contactsRoutes from './routes/contacts.js';
import mcpRoutes from './routes/mcp.js';
import patientRoutes from './routes/patient.js';
import homeRoutes from './routes/home.js';
import { resolveJwtSecret } from './lib/config.js';
import { startScheduler } from './lib/scheduler.js';
import { startTelegramBot } from './lib/telegramBot.js';
import { HARDCODED_USER_ID } from './lib/auth.js';
import { userLanguage } from './lib/userLocale.js';
import { t } from './lib/i18n.js';
import { CoreError, HTTP_STATUS, errorBody } from './lib/errors.js';

// JWT_SECRET from .env, or generated once into DATA_DIR/jwt.secret (first-run wizard installs have no .env).
const JWT_SECRET = resolveJwtSecret();

// trustProxy: only the private networks in front of us (edge → frontend proxy); the edge sets the real client IP.
// Logged URLs drop the query string: search terms and filters are medical data.
const app = Fastify({
  trustProxy: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  logger: { serializers: { req: (r) => ({ method: r.method, url: String(r.url || '').split('?')[0], remoteAddress: r.ip }) } },
});

// Only the app's own origin (plus WEBAUTHN_ORIGINS and, on the server, localhost for development) may call the API from
// a browser. The desktop app has exactly one origin: another local server on :3001 is not ours.
const DESKTOP = edition() === 'desktop';
const ORIGINS = [process.env.APP_URL, ...(process.env.WEBAUTHN_ORIGINS || '').split(','), ...(DESKTOP ? [] : ['http://localhost:3001', 'http://127.0.0.1:3001'])].map((s) => (s || '').trim().replace(/\/$/, '')).filter(Boolean);
if (DESKTOP) app.addHook('onRequest', desktopHostGuard(Number(process.env.GATEWAY_PORT) || 3000));
await app.register(cors, { origin: (origin, cb) => cb(null, !origin || ORIGINS.includes(origin)) });
await app.register(jwt, { secret: JWT_SECRET });
// Swagger UI only in development: the app may be published to the internet.
if (process.env.ENABLE_DOCS === '1') {
  await app.register(swagger, { openapi: { info: { title: 'MedControl Gateway', version: '0.4.2' } } });
  await app.register(swaggerUI, { routePrefix: '/docs' });
}
await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024, files: 50, fields: 10, fieldSize: 256 * 1024 }
});

// 5xx never leak internals (pg messages, upstream bodies); 4xx keep their payloads.
app.setErrorHandler((err, req, reply) => {
  if (err instanceof CoreError) return reply.code(HTTP_STATUS[err.kind] || 400).send(errorBody(err));
  if (err.name === 'TimeoutError' || err.name === 'AbortError') { req.log.warn({ err: err.message }, 'upstream timeout'); return reply.code(504).send({ error: 'timeout' }); }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/.test(String(err.message) + String(err.cause?.code || ''))) { req.log.warn({ err: err.message, cause: err.cause?.code }, 'upstream unreachable'); return reply.code(502).send({ error: 'network' }); }
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status >= 500) { req.log.error({ err }, 'unhandled'); return reply.code(500).send({ error: 'internal' }); }
  return reply.code(status).send({ error: err.code || 'error', message: err.message });
});

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || fileURLToPath(new URL('../../db/migrations', import.meta.url));
await runMigrations(pool, MIGRATIONS_DIR, app.log);
await loadCatalog(pool);
await loadSettings();
if (process.env.RECANONICALIZE_ON_START !== '0') { await recanonicalize(pool, app.log); await renormalizeUnits(pool, app.log); }

await ensureUser();
prepareSetupCode(setupNeeded(), app.log);
if (ENV_PASSWORD_WARNING) app.log.warn(ENV_PASSWORD_WARNING);
// the viewer no longer asks for it (edge adds it), so it can and should be long and random
if (process.env.ORTHANC_PASSWORD && process.env.ORTHANC_PASSWORD.length < 16) app.log.warn('ORTHANC_PASSWORD is shorter than 16 characters: set a random one, e.g. openssl rand -hex 24 (see docs/OPERATIONS.md)');
await sweepPending(7, app.log);

app.decorate('authenticate', authenticate);

// /health: database only (fast, used by docker). /health?deep=1 also checks the parser, DICOM archive,
// egress proxy, backup age and configuration; returns 503 when the database is down, 200 with a
// `degraded` list otherwise (the watchdog service reads it).
app.get('/health', async (req, reply) => {
  const deep = req.query?.deep === '1';
  const checks = {};
  const run = async (name, fn) => { try { const v = await fn(); checks[name] = typeof v === 'string' ? v : 'ok'; } catch (e) { checks[name] = `fail: ${String(e?.message || e).slice(0, 120)}`; } };
  await run('db', () => pool.query('select 1'));
  if (deep) {
    const [{ orthancEnabled, orthancSystem }, { egressProxy, egressPublicIp }, { backupStatus }, { telegramReady }, { llmConfig }] = await Promise.all([
      import('./lib/orthanc.js'), import('./lib/egress.js'), import('./lib/backupStatus.js'), import('./lib/telegram.js'), import('./lib/llm.js'),
    ]);
    const { pdfEngineHealth } = await import('./lib/pdfEngine.js');
    await Promise.all([
      run('ingestion', () => pdfEngineHealth()),
      run('orthanc', async () => { if (!orthancEnabled()) return 'off'; await orthancSystem(); }),
      run('egress', async () => { if (!egressProxy()) return 'off'; await egressPublicIp(); }),
      run('backup', async () => { if (!available('backups')) return 'off'; const b = await backupStatus(await userLanguage(HARDCODED_USER_ID)); if (!b) return 'unknown'; if (!b.ok) throw new Error(b.problems.join('; ')); }),
      run('telegram', async () => (telegramReady() ? 'ok' : 'off')),
      run('llm', async () => (llmConfig().enabled ? 'ok' : 'off')),
    ]);
  }
  const degraded = Object.entries(checks).filter(([, v]) => !['ok', 'off', 'unknown'].includes(v)).map(([k, v]) => `${k}: ${v}`);
  const ok = checks.db === 'ok';
  return reply.code(ok ? 200 : 503).send({ ok, degraded, checks, uptimeSec: Math.round(process.uptime()) });
});

await app.register(authRoutes);
await app.register(labsRoutes);
await app.register(labsExportRoutes);
await app.register(labSampleRoutes);
await app.register(attachmentsRoutes);
await app.register(medsRoutes);
await app.register(timelineRoutes);
await app.register(symptomsRoutes);
await app.register(alertsRoutes);
await app.register(milestonesRoutes);
await app.register(imagingRoutes);
await app.register(notifyRoutes);
await app.register(reportRoutes);
await app.register(aiRoutes);
await app.register(appointmentsRoutes);
await app.register(infusionsRoutes);
await app.register(exportRoutes);
await app.register(notesRoutes);
await app.register(healthRoutes);
await app.register(searchRoutes);
await app.register(protocolRoutes);
await app.register(setupRoutes);
await app.register(localeRoutes);
await app.register(labRefsRoutes);
await app.register(contactsRoutes);
await app.register(mcpRoutes);
await app.register(patientRoutes);
await app.register(homeRoutes);

startScheduler({ pool, userId: HARDCODED_USER_ID, log: app.log });
const stopBot = startTelegramBot({ userId: HARDCODED_USER_ID, log: app.log });
await pool.query('update dicom_imports set error = $1, finished_at = now() where finished_at is null', [t(await userLanguage(HARDCODED_USER_ID).catch(() => undefined), 'notify.importInterrupted')]).catch(() => {});
// pool.end() lets PGlite checkpoint its files before the process exits.
let stopping = false;
const shutdown = (why) => {
  if (stopping) return;
  stopping = true;
  app.log.info({ sig: why }, 'shutting down');
  stopBot?.();
  app.close().then(() => pool.end()).finally(() => process.exit(0));
};
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(sig));
// The desktop app holds our stdin and closes it to stop us (Windows has no SIGTERM); a crashed app closes it too.
if (process.env.DTC_EXIT_WITH_PARENT === '1') {
  process.stdin.on('end', () => shutdown('stdin closed'));
  process.stdin.on('error', () => shutdown('stdin closed'));
  process.stdin.resume();
}

// The desktop app listens on 127.0.0.1 only (GATEWAY_HOST from lib/desktopEnv.js) on a port its launcher picks.
app.listen({ host: process.env.GATEWAY_HOST || '0.0.0.0', port: Number(process.env.GATEWAY_PORT) || 3000 });
