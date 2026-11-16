import { getUserLocale, setUserLocale, localeOptions } from '../lib/userLocale.js';
import { settingsSummary } from '../lib/settingsSummary.js';
import { TOKEN_TTL, sessionClaims } from '../lib/auth.js';

/** Language and region (Settings → «Язык и регион»), docs/I18N.md. */
export default async function localeRoutes(app) {
  app.get('/settings/locale', { preHandler: app.authenticate }, async (req) => ({ ...(await getUserLocale(req.user.sub)), options: localeOptions() }));
  // Every Settings section at a glance: codes and numbers, worded by the interface.
  app.get('/settings/summary', { preHandler: app.authenticate }, async (req) => settingsSummary(req.user.sub));
  app.put('/settings/locale', { preHandler: app.authenticate }, async (req, reply) => {
    const saved = await setUserLocale(req.user.sub, req.body || {});
    // The session token carries the time zone (days are counted in it): a new zone comes with a new token. The time
    // the password was typed is copied as it was: a token issued again must not renew the grace of sensitiveConfirmed.
    const token = saved.timeZone !== req.user.tz ? await reply.jwtSign(sessionClaims(req.user.sub, saved.timeZone, { passwordAt: req.user.pw }), { expiresIn: TOKEN_TTL }) : undefined;
    return { ok: true, ...saved, token };
  });
}
