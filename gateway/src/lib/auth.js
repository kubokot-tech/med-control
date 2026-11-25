import { z } from 'zod';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pool } from './db.js';
import { DEFAULT_TZ, isValidTz } from './dates.js';
import { createLoginGuard, createRateLimit, safeEqual } from './loginGuard.js';
import { notifyUser } from './notifyUser.js';
import { getSetting } from './settings.js';
import {
  listPasskeys, countPasskeys, registrationOptions, registrationVerify,
  authenticationOptions, authenticationVerify, deletePasskey, rpConfig,
} from './passkeys.js';

// The single user's password: DTC_PASSWORD in .env or the first-run wizard (lib/setup.js).
import { currentLogin, checkPassword, setupNeeded, changePassword, credentialsSource, USER_ID } from './setup.js';
import { available, requireFeature } from './edition.js';
import { recoverPassword, recoveryStatus, issueRecoveryCode } from './recovery.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
export const HARDCODED_USER_ID = USER_ID;
export const TOKEN_TTL = process.env.JWT_TTL || '30d';
// DTC_MFA=off disables the passkey step (break-glass if all keys are lost).
const MFA_ENABLED = process.env.DTC_MFA !== 'off';
// Anonymous sign-in (password, recovery code): per address plus a global net against distributed guessing
const guard = createLoginGuard();
// Password re-checks inside a session: per address, with no share in the sign-in net, so strangers failing logins cannot
// block the owner's settings. Only a holder of a valid session gets here at all, and the slow cap is for that one: a
// stolen session guessing the password from many addresses gets 20 tries, then everybody waits half an hour. The owner
// is not locked out by it for long: «Выйти везде» needs no password and ends the stolen session.
const confirmGuard = createLoginGuard({ globalThreshold: Infinity, slowCap: { limit: 20, windowMs: 3_600_000, lockMs: 30 * 60_000 } });
// passkey-first login options: anyone may ask, so limit how often
const directLimit = createRateLimit({ limit: 10, windowMs: 60_000 });
const DEVICE_TTL = '400d';
/** How long after typing the password a session may change sensitive settings without typing it again. */
export const PASSWORD_GRACE_S = 15 * 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ensure hardcoded user exists for stable FK relations
export async function ensureUser() {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, timezone)
     VALUES ($1, $2, '', 'Europe/Moscow')
     ON CONFLICT (id) DO NOTHING`,
    [HARDCODED_USER_ID, currentLogin()]
  );
}

const LoginBody = z.object({ password: z.string().min(1) });

/** Root-level decorator: must be attached to the root app so every route plugin sees it. */
export function tokenVersion() { return Number(getSetting('token_version') || 0); }

export async function authenticate(req, reply) {
  try {
    await req.jwtVerify();
    // A token issued after the password step only (scope=mfa) opens nothing but the passkey step.
    if (req.user.scope) throw new Error('scope');
    // Tokens issued before the last 'log out everywhere' are rejected.
    if ((req.user.tv || 0) !== tokenVersion()) throw new Error('revoked');
  } catch {
    reply.code(401).send({ error: 'unauthorized' });
  }
}

/** Long-lived key for integrations (Health Auto Export, Shortcuts): only its hash is stored. */
const tokenHash = (t) => createHash('sha256').update(String(t)).digest('hex');
export async function authenticateIntegration(req, reply) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const stored = getSetting('integration_token_hash');
  if (token && stored && token.length >= 32 && safeEqual(tokenHash(token), stored)) { req.user = { sub: HARDCODED_USER_ID, tz: await userTz(), integration: true }; return; }
  // a normal session token also works (the settings page tests the endpoint)
  try {
    await req.jwtVerify();
    if (req.user.scope) throw new Error('scope');
    if ((req.user.tv || 0) !== tokenVersion()) throw new Error('revoked');
  } catch { reply.code(401).send({ error: 'unauthorized' }); }
}

/** Accepts only the short-lived token from the password step. */
async function authenticateMfa(req, reply) {
  try {
    await req.jwtVerify();
    if (req.user.scope !== 'mfa') throw new Error('scope');
    if ((req.user.tv || 0) !== tokenVersion()) throw new Error('revoked');
  } catch {
    reply.code(401).send({ error: 'unauthorized' });
  }
}

async function userTz() {
  const u = await pool.query('select timezone from users where id=$1', [HARDCODED_USER_ID]);
  return isValidTz(u.rows[0]?.timezone) ? u.rows[0].timezone : DEFAULT_TZ;
}

function passkeyError(reply, e) {
  const code = e?.code || 'verify';
  const status = code === 'challenge' ? 410 : code === 'unknown' ? 404 : 400;
  return reply.code(status).send({ error: `passkey_${code}`, message: e?.message });
}

/**
 * «Known device» mark, given with every sign-in and kept by the browser. It opens nothing (authenticate refuses any
 * token with a scope); it only lets sign-in from a device the owner has used before skip the global lock, so strangers
 * guessing passwords from many addresses cannot lock the owner out. The per-address lock still applies.
 */
export const deviceMark = (reply) => reply.jwtSign({ sub: HARDCODED_USER_ID, scope: 'device', tv: tokenVersion() }, { expiresIn: DEVICE_TTL });
/**
 * The mark carries the token version, like a session: a new password or «Выйти везде» ends the marks given before, so
 * a device that knew the old password (a lost phone) is a stranger again and waits behind the global lock.
 */
function knownDevice(req) {
  const t = String(req.body?.device || '');
  if (!t) return false;
  try {
    const mark = req.server.jwt.verify(t);
    return mark?.scope === 'device' && (mark.tv || 0) === tokenVersion();
  } catch { return false; }
}
/** Sign-in limits for this request: a known device answers only for its own address. */
function signInGuard(req) {
  const known = knownDevice(req);
  return {
    retryAfterMs: () => (known ? guard.retryAfterIpMs(req.ip) : guard.retryAfterMs(req.ip)),
    fail: () => (known ? guard.failIp(req.ip) : guard.fail(req.ip)),
    succeed: () => guard.succeed(req.ip),
  };
}

/**
 * Re-check the password before anything that outlives the session (integration key, MCP access and tokens): a stolen
 * session token alone must not be enough to plant permanent access. Sends 429/403 itself and returns false on failure.
 */
export async function passwordConfirmed(req, reply) {
  const wait = confirmGuard.retryAfterMs(req.ip);
  if (wait > 0) { reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) }); return false; }
  if (!checkPassword(String(req.body?.password || ''))) {
    confirmGuard.fail(req.ip);
    await sleep(500);
    reply.code(403).send({ error: 'invalid_password' });
    return false;
  }
  confirmGuard.succeed(req.ip);
  return true;
}

/**
 * The payload of a session token. `passwordAt` (seconds) goes in as `pw` only when the password itself was typed for
 * this sign-in: the password or the first-run wizard, the password step before a passkey, a password change, a reset
 * by the recovery code. A sign-in by a passkey alone has none. A token issued again inside a session (a new time zone)
 * copies the old value, so it never moves forward without the password.
 */
export function sessionClaims(sub, tz, { passwordAt = null } = {}) {
  return { sub, tz, tv: tokenVersion(), ...(Number.isFinite(passwordAt) && passwordAt > 0 ? { pw: Math.floor(passwordAt) } : {}) };
}
const nowS = () => Math.floor(Date.now() / 1000);

/** Was the password typed for this session less than PASSWORD_GRACE_S ago? (`user`: the verified token payload) */
export function passwordFresh(user, now = nowS()) {
  const at = Number(user?.pw);
  return Number.isFinite(at) && at > 0 && now >= at - 60 && now - at < PASSWORD_GRACE_S;
}

/**
 * Settings that decide where the medical data goes (the AI service and its keys, the Telegram bot and chat): a stolen
 * session token alone must not be enough to point them somewhere else. The password is asked again, except in the
 * first PASSWORD_GRACE_S after it was typed to sign in, so that the first-run steps (connect AI right after the wizard)
 * do not ask for it twice. Without a password in the body the answer is 403 `password_required` and counts as no
 * guess; a wrong one is 403 `invalid_password` and counts. Sends the answer itself and returns false on failure.
 */
export async function sensitiveConfirmed(req, reply) {
  if (passwordFresh(req.user)) return true;
  if (!req.body?.password) { reply.code(403).send({ error: 'password_required' }); return false; }
  return passwordConfirmed(req, reply);
}

/** «Выйти везде» and a new password also end what lives beyond sessions: the integration key and every MCP token. */
async function revokeLongLived(userId) {
  const { setSetting } = await import('./settings.js');
  await setSetting('integration_token_hash', '');
  await setSetting('integration_token_created', '');
  const { revokeAllTokens } = await import('./mcpAccess.js');
  await revokeAllTokens(userId);
}

export default async function authRoutes(app) {
  app.post('/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const g = signInGuard(req);
    const wait = g.retryAfterMs();
    if (wait > 0) {
      reply.header('Retry-After', Math.ceil(wait / 1000));
      return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) });
    }

    if (setupNeeded()) return reply.code(409).send({ error: 'setup_needed' });
    if (!checkPassword(parsed.data.password)) {
      const lock = g.fail();
      req.log.warn({ ip: req.ip, failures: guard.failuresFor(req.ip), lockMs: lock }, 'login failed');
      await sleep(500);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    g.succeed();

    const tz = await userTz();
    if (MFA_ENABLED && available('passkeys') && (await countPasskeys(HARDCODED_USER_ID)) > 0) {
      const preToken = await reply.jwtSign({ sub: HARDCODED_USER_ID, tz, scope: 'mfa', tv: tokenVersion(), jti: randomUUID() }, { expiresIn: '5m' });
      return { mfa: 'passkey', preToken };
    }
    const token = await reply.jwtSign(sessionClaims(HARDCODED_USER_ID, tz, { passwordAt: nowS() }), { expiresIn: TOKEN_TTL });
    return { token, tz, device: await deviceMark(reply) };
  });

  // Second step of login: passkey (WebAuthn) with the short-lived token from the password step.
  app.post('/auth/passkey/login/options', { preHandler: authenticateMfa }, async (req, reply) => {
    requireFeature('passkeys');
    try {
      return await authenticationOptions(req.user.sub, req.user.jti);
    } catch (e) { return passkeyError(reply, e); }
  });
  app.post('/auth/passkey/login/verify', { preHandler: authenticateMfa }, async (req, reply) => {
    try {
      const used = await authenticationVerify(req.user.sub, req.user.jti, req.body?.response);
      req.log.info({ passkey: used.id }, 'passkey login ok');
      // the password was typed when the short-lived token of the first step was issued
      const token = await reply.jwtSign(sessionClaims(req.user.sub, req.user.tz, { passwordAt: req.user.iat }), { expiresIn: TOKEN_TTL });
      return { token, tz: req.user.tz, device: await deviceMark(reply) };
    } catch (e) {
      req.log.warn({ ip: req.ip, err: e?.message }, 'passkey login failed');
      return passkeyError(reply, e);
    }
  });

  // Passkey-first login: no password, the browser picks a discoverable credential (Face ID / Touch ID).
  // A passkey is possession + biometrics, so it counts as both factors. Rate-limited like the password.
  app.post('/auth/passkey/direct/options', async (req, reply) => {
    requireFeature('passkeys');
    const wait = Math.max(guard.retryAfterIpMs(req.ip), directLimit.hit(req.ip));
    if (wait > 0) { reply.header('Retry-After', Math.ceil(wait / 1000)); return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) }); }
    if (!MFA_ENABLED || (await countPasskeys(HARDCODED_USER_ID)) === 0) return reply.code(404).send({ error: 'no_passkeys' });
    const sessionId = randomUUID();
    try {
      const options = await authenticationOptions(HARDCODED_USER_ID, `direct:${sessionId}`, { discoverable: true });
      return { sessionId, options };
    } catch (e) { return passkeyError(reply, e); }
  });
  app.post('/auth/passkey/direct/verify', async (req, reply) => {
    const wait = guard.retryAfterIpMs(req.ip);
    if (wait > 0) { reply.header('Retry-After', Math.ceil(wait / 1000)); return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) }); }
    const sessionId = String(req.body?.sessionId || '');
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) return reply.code(400).send({ error: 'invalid_body' });
    try {
      const used = await authenticationVerify(HARDCODED_USER_ID, `direct:${sessionId}`, req.body?.response);
      guard.succeed(req.ip);
      req.log.info({ passkey: used.id }, 'passkey direct login ok');
      const tz = await userTz();
      // no password was typed: sensitive settings will ask for it (sensitiveConfirmed)
      const token = await reply.jwtSign(sessionClaims(HARDCODED_USER_ID, tz), { expiresIn: TOKEN_TTL });
      return { token, tz, device: await deviceMark(reply) };
    } catch (e) {
      // no guard.fail: a failed passkey assertion is not a password guess, and counting it would let anyone lock the owner out
      req.log.warn({ ip: req.ip, err: e?.message }, 'passkey direct login failed');
      await sleep(500);
      return passkeyError(reply, e);
    }
  });

  // Integration key: created once, shown once; revoke to invalidate.
  app.post('/auth/integration-token', { preHandler: app.authenticate }, async (req, reply) => {
    requireFeature('appleHealth');
    if (!(await passwordConfirmed(req, reply))) return reply;
    const { setSetting } = await import('./settings.js');
    const token = `dtc_${randomBytes(32).toString('base64url')}`;
    await setSetting('integration_token_hash', tokenHash(token));
    await setSetting('integration_token_created', new Date().toISOString());
    return { token };
  });
  app.delete('/auth/integration-token', { preHandler: app.authenticate }, async () => {
    const { setSetting } = await import('./settings.js');
    await setSetting('integration_token_hash', '');
    await setSetting('integration_token_created', '');
    return { ok: true };
  });

  // Change the password set by the first-run wizard. Other sessions are revoked; this one gets a fresh token.
  app.post('/auth/password', { preHandler: app.authenticate }, async (req, reply) => {
    const wait = confirmGuard.retryAfterMs(req.ip);
    if (wait > 0) return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) });
    try {
      await changePassword(req.body?.current, req.body?.next);
    } catch (e) {
      if (e.code === 'invalid_password') { confirmGuard.fail(req.ip); await sleep(500); return reply.code(403).send({ error: 'invalid_password' }); }
      if (['set_in_env', 'weak_password', 'same_password'].includes(e.code)) return reply.code(e.code === 'set_in_env' ? 409 : 400).send({ error: e.code });
      throw e;
    }
    confirmGuard.succeed(req.ip);
    const { setSetting } = await import('./settings.js');
    await setSetting('token_version', String(tokenVersion() + 1));
    await revokeLongLived(req.user.sub);
    notifyUser(req.user.sub, 'passwordChanged');
    const token = await reply.jwtSign(sessionClaims(req.user.sub, req.user.tz, { passwordAt: nowS() }), { expiresIn: TOKEN_TTL });
    // the marks given before stopped with the old password: this browser gets a new one
    return { ok: true, token, device: await deviceMark(reply) };
  });
  app.get('/auth/password', { preHandler: app.authenticate }, async () => ({ source: credentialsSource() }));

  // Forgotten password: the recovery code from the wizard sets a new one. Rate-limited like the password; on success
  // every session and long-lived access ends, and a new code replaces the used one.
  app.post('/auth/recover', async (req, reply) => {
    const g = signInGuard(req);
    const wait = g.retryAfterMs();
    if (wait > 0) { reply.header('Retry-After', Math.ceil(wait / 1000)); return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) }); }
    if (setupNeeded()) return reply.code(409).send({ error: 'setup_needed' });
    let recoveryCode;
    try {
      recoveryCode = await recoverPassword(req.body?.code, req.body?.next);
    } catch (e) {
      if (e.code === 'invalid_recovery_code' || e.code === 'no_recovery_code') {
        const lock = g.fail();
        req.log.warn({ ip: req.ip, failures: guard.failuresFor(req.ip), lockMs: lock }, 'password recovery failed');
        await sleep(500);
        return reply.code(403).send({ error: e.code });
      }
      if (e.code === 'set_in_env' || e.code === 'weak_password') return reply.code(e.code === 'set_in_env' ? 409 : 400).send({ error: e.code });
      throw e;
    }
    g.succeed();
    req.log.warn({ ip: req.ip }, 'password reset with the recovery code');
    notifyUser(HARDCODED_USER_ID, 'passwordReset');
    const tz = await userTz();
    const token = await reply.jwtSign(sessionClaims(HARDCODED_USER_ID, tz, { passwordAt: nowS() }), { expiresIn: TOKEN_TTL });
    return { token, tz, recoveryCode, device: await deviceMark(reply) };
  });
  app.get('/auth/recovery', { preHandler: app.authenticate }, async () => recoveryStatus());
  // A new code (the old one lost or seen by someone): asks for the password, like anything long-lived.
  app.post('/auth/recovery', { preHandler: app.authenticate }, async (req, reply) => {
    if (!recoveryStatus().applicable) return reply.code(409).send({ error: 'set_in_env' });
    if (!(await passwordConfirmed(req, reply))) return reply;
    const recoveryCode = await issueRecoveryCode();
    notifyUser(req.user.sub, 'recoveryCode');
    return { recoveryCode };
  });

  // Invalidate every issued token (lost phone): bumps token_version; the caller must log in again.
  app.post('/auth/logout-all', { preHandler: app.authenticate }, async (req) => {
    const { setSetting } = await import('./settings.js');
    await setSetting('token_version', String(tokenVersion() + 1));
    await revokeLongLived(req.user.sub);
    notifyUser(req.user.sub, 'allSessionsEnded');
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    return { userId: req.user.sub, tz: req.user.tz };
  });

  // Passkey management (full session required).
  app.get('/auth/passkeys', { preHandler: app.authenticate }, async (req) => {
    const { rpID, origins } = rpConfig();
    return { passkeys: await listPasskeys(req.user.sub), mfaEnabled: MFA_ENABLED, rpID, origins };
  });
  // Adding a key needs the password: a stolen session token must not be enough to plant a permanent login.
  app.post('/auth/passkey/register/options', { preHandler: app.authenticate }, async (req, reply) => {
    requireFeature('passkeys');
    const wait = confirmGuard.retryAfterMs(req.ip);
    if (wait > 0) return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) });
    if (!checkPassword(String(req.body?.password || ''))) {
      confirmGuard.fail(req.ip);
      await sleep(500);
      return reply.code(403).send({ error: 'invalid_password' });
    }
    confirmGuard.succeed(req.ip);
    try {
      return await registrationOptions(req.user.sub, currentLogin(), await userLanguage(req.user.sub));
    } catch (e) { return passkeyError(reply, e); }
  });
  app.post('/auth/passkey/register/verify', { preHandler: app.authenticate }, async (req, reply) => {
    const name = String(req.body?.name || '').trim().slice(0, 60) || t(await userLanguage(req.user.sub), 'feedTitles.passkeyDefault');
    try {
      const r = await registrationVerify(req.user.sub, req.body?.response, name);
      notifyUser(req.user.sub, 'passkeyAdded', { name });
      return { ok: true, id: r.id };
    } catch (e) { return passkeyError(reply, e); }
  });
  // Removing a key needs the password again: this is what weakens login.
  app.delete('/auth/passkeys/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const wait = confirmGuard.retryAfterMs(req.ip);
    if (wait > 0) return reply.code(429).send({ error: 'too_many_attempts', retryAfterSec: Math.ceil(wait / 1000) });
    const password = String(req.body?.password || '');
    if (!checkPassword(password)) {
      confirmGuard.fail(req.ip);
      await sleep(500);
      return reply.code(403).send({ error: 'invalid_password' });
    }
    confirmGuard.succeed(req.ip);
    const ok = await deletePasskey(req.user.sub, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    notifyUser(req.user.sub, 'passkeyRemoved');
    return { ok: true };
  });
}
