import { z } from 'zod';
import { setupNeeded, completeSetup, credentialsSource, USER_ID } from '../lib/setup.js';
import { listPresets } from '../lib/protocol.js';
import { normalizeLanguage } from '../../../shared/format.js';
import { ensureTelegramBot } from '../lib/telegramBot.js';
import { sessionClaims, deviceMark } from '../lib/auth.js';
import { createLoginGuard } from '../lib/loginGuard.js';
import { editionInfo } from '../lib/edition.js';
import { issueRecoveryCode } from '../lib/recovery.js';
import { setupCodeRequired, checkSetupCode, clearSetupCode, publicAddress } from '../lib/setupCode.js';

// Per address, without the global net of sign-in: that one doubles its lock and would let strangers guessing the code
// keep the owner out of the wizard. Many addresses still must not guess forever, so there is a slow cap: 100 wrong codes
// from the internet within ten minutes and the internet waits ten minutes. It never counts or holds up this machine and
// the home network, where the owner (who reads the code on the server) can always finish the wizard.
const guard = createLoginGuard({ threshold: 10, globalThreshold: Infinity, slowCap: { limit: 100, windowMs: 600_000, lockMs: 600_000, applies: publicAddress } });
const TOKEN_TTL = process.env.JWT_TTL || '30d';
// two wizard requests at once must not both pass the «no password yet» check
let busy = false;

export default async function setupRoutes(app) {
  // Server or desktop edition and the features it lacks (lib/edition.js); public: the login page needs it.
  app.get('/edition', async () => editionInfo());
  // Public: the frontend asks whether to show the wizard or the login form.
  app.get('/setup/status', async (req) => ({
    needed: setupNeeded(),
    codeRequired: setupNeeded() && setupCodeRequired(req.ip),
    credentialsSource: credentialsSource(),
    presets: listPresets(normalizeLanguage(req.query?.language)),
    appUrl: (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, ''),
  }));
  // One-shot: works only while no password exists; returns a session so the user lands in the app.
  app.post('/setup', async (req, reply) => {
    if (!setupNeeded()) return reply.code(409).send({ error: 'setup_done' });
    const wait = guard.retryAfterMs(req.ip);
    if (wait > 0) { reply.header('Retry-After', Math.ceil(wait / 1000)); return reply.code(429).send({ error: 'too_many_attempts' }); }
    if (setupCodeRequired(req.ip) && !checkSetupCode(req.body?.setupCode)) {
      guard.fail(req.ip);
      req.log.warn({ ip: req.ip }, 'first-run setup: wrong setup code');
      return reply.code(403).send({ error: 'invalid_setup_code' });
    }
    if (busy) return reply.code(409).send({ error: 'setup_busy' });
    busy = true;
    try {
      const { tz } = await completeSetup(req.body || {});
      // shown once on the next screen of the wizard: the only way back in if the password is forgotten
      const recoveryCode = await issueRecoveryCode();
      clearSetupCode();
      guard.succeed(req.ip);
      ensureTelegramBot();
      req.log.info('first-run setup completed');
      const token = await reply.jwtSign(sessionClaims(USER_ID, tz, { passwordAt: Math.floor(Date.now() / 1000) }), { expiresIn: TOKEN_TTL });
      return { ok: true, token, tz, recoveryCode, device: await deviceMark(reply) };
    } catch (e) {
      // a weak password or a bad field is not a guess: only a wrong setup code counts against the address
      if (e instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_body', details: e.issues });
      if (e.code === 'weak_password') return reply.code(400).send({ error: 'weak_password' });
      if (e.code === 'bad_timezone') return reply.code(400).send({ error: 'bad_timezone' });
      if (e.code === 'preset_not_found') return reply.code(400).send({ error: 'preset_not_found' });
      if (e.code === 'setup_done') return reply.code(409).send({ error: 'setup_done' });
      throw e;
    } finally {
      busy = false;
    }
  });
}
