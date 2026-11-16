import { authenticateIntegration } from '../lib/auth.js';
import { parseHealthAutoExport, importSamples, healthStatus } from '../lib/healthImport.js';
import { getSetting } from '../lib/settings.js';
import { DEFAULT_TZ } from '../lib/dates.js';
import { requireFeature } from '../lib/edition.js';

export default async function healthRoutes(app) {
  // Receiver for Health Auto Export (REST API automation) or a Shortcut posting the same JSON.
  // The key is checked in onRequest, before the body is read: a stranger must not make the gateway parse 25 MB of JSON.
  app.post('/health/import', { onRequest: authenticateIntegration, bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    requireFeature('appleHealth');
    const samples = parseHealthAutoExport(req.body);
    if (!samples.length) return reply.code(400).send({ error: 'no_samples', message: 'В запросе нет распознанных показателей (ожидается формат Health Auto Export: data.metrics[])' });
    const summary = await importSamples(req.user.sub, samples, { tz: req.user.tz || DEFAULT_TZ, source: req.user.integration ? 'health_auto_export' : 'manual' });
    req.log.info(summary, 'health import');
    return { ok: true, ...summary };
  });
  app.get('/health/status', { preHandler: app.authenticate }, async (req) => ({
    ...(await healthStatus(req.user.sub)),
    keyCreated: getSetting('integration_token_created') || null,
    endpoint: `${(process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')}/api/gateway/health/import`,
  }));
}
