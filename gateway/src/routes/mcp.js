import { readFileSync } from 'node:fs';
import { handleMcp } from '../lib/mcpServer.js';
import { mcpEnabled, mcpDisabledByAdmin, setMcpEnabled, listTokens, createToken, revokeToken, verifyToken, rateLimited, audit, listAudit } from '../lib/mcpAccess.js';
import { getUserLocale } from '../lib/userLocale.js';
import { notifyUser } from '../lib/notifyUser.js';
import { t } from '../lib/i18n.js';
import { UUID_RX } from '../lib/labsQuery.js';
import { passwordConfirmed } from '../lib/auth.js';

const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch { return '0'; } })();
const appUrl = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');

/**
 * MCP for AI agents (docs/MCP.md): POST /mcp with an agent token, and the settings that control it.
 * While MCP is off the endpoint answers 404 as if it did not exist.
 */
export default async function mcpRoutes(app) {
  app.post('/mcp', async (req, reply) => {
    if (!mcpEnabled()) return reply.code(404).send({ error: 'not_found' });
    // Browsers send Origin; a page on another site must not drive the endpoint (DNS rebinding, CSRF). Agents send none.
    const origin = req.headers.origin;
    if (origin && origin !== new URL(appUrl()).origin) return reply.code(403).send({ error: 'forbidden' });
    const h = String(req.headers.authorization || '');
    const token = await verifyToken(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
    if (!token) {
      reply.header('WWW-Authenticate', 'Bearer realm="medcontrol-mcp"');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (rateLimited(token.id)) return reply.code(429).send({ error: 'too_many_requests' });
    const { timeZone, language } = await getUserLocale(token.user_id);
    const out = await handleMcp(req.body, {
      userId: token.user_id, tz: timeZone, language, token, version: VERSION, log: req.log,
      audit: (e) => audit(token.user_id, token.id, e),
    });
    if (out.body == null) return reply.code(out.status).send();
    return reply.code(out.status).header('content-type', 'application/json').send(out.body);
  });
  // no server-sent stream and no sessions in this server
  app.get('/mcp', async (_req, reply) => reply.code(mcpEnabled() ? 405 : 404).header('Allow', 'POST').send());
  app.delete('/mcp', async (_req, reply) => reply.code(mcpEnabled() ? 405 : 404).header('Allow', 'POST').send());

  // Settings → «Доступ для ИИ-агентов (MCP)»
  app.get('/settings/mcp', { preHandler: app.authenticate }, async (req) => ({
    enabled: mcpEnabled(), disabledByAdmin: mcpDisabledByAdmin(), endpoint: `${appUrl()}/api/gateway/mcp`,
    tokens: await listTokens(req.user.sub), audit: await listAudit(req.user.sub, 50),
  }));
  app.put('/settings/mcp', { preHandler: app.authenticate }, async (req, reply) => {
    const on = req.body?.enabled === true;
    // switching on needs the password (switching off never does)
    if (on && !(await passwordConfirmed(req, reply))) return reply;
    const enabled = await setMcpEnabled(req.user.sub, on, { acknowledged: req.body?.acknowledged === true });
    notifyUser(req.user.sub, on ? 'mcpOn' : 'mcpOff');
    return { ok: true, enabled };
  });
  app.post('/settings/mcp/tokens', { preHandler: app.authenticate }, async (req, reply) => {
    if (!(await passwordConfirmed(req, reply))) return reply;
    const { token, info } = await createToken(req.user.sub, { name: req.body?.name, scope: req.body?.scope || 'read' });
    const { language } = await getUserLocale(req.user.sub);
    notifyUser(req.user.sub, 'mcpToken', { name: info.name, scope: t(language, `notify.mcpScope.${info.scope}`) });
    return { ok: true, token, info };
  });
  app.delete('/settings/mcp/tokens/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    await revokeToken(req.user.sub, id);
    return { ok: true };
  });
}
