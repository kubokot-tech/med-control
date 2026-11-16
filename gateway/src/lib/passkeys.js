import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { pool } from './db.js';
import { t } from './i18n.js';


/** Relying party id and allowed origins come from APP_URL (plus WEBAUTHN_ORIGINS, comma-separated). */
export function rpConfig() {
  const app = new URL(process.env.APP_URL || 'http://localhost:3001');
  const extra = (process.env.WEBAUTHN_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { rpID: app.hostname, origins: [app.origin, ...extra] };
}

/**
 * In-memory challenges: single user, single process. Anonymous ones (`direct:`, passkey-first login) live apart from
 * those of the owner's own steps (`reg:`, `auth:<jti>`): a flood of anonymous requests can then push out only other
 * anonymous challenges, never the owner's registration or second step.
 */
const owned = new Map();
const anonymous = new Map();
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 1000;
const mapFor = (key) => (key.startsWith('auth:direct:') ? anonymous : owned);
function putChallenge(key, challenge) {
  const now = Date.now();
  const challenges = mapFor(key);
  for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  if (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
  challenges.set(key, { challenge, exp: now + CHALLENGE_TTL_MS });
}
function takeChallenge(key) {
  const challenges = mapFor(key);
  const c = challenges.get(key);
  challenges.delete(key);
  if (!c || c.exp < Date.now()) return null;
  return c.challenge;
}

export async function listPasskeys(userId) {
  const r = await pool.query(
    `select id, name, device_type, backed_up, transports, created_at, last_used_at
       from passkeys where user_id=$1 order by created_at`,
    [userId]
  );
  return r.rows.map((p) => ({
    id: p.id, name: p.name, deviceType: p.device_type, backedUp: p.backed_up,
    transports: p.transports, createdAt: p.created_at, lastUsedAt: p.last_used_at,
  }));
}

export async function countPasskeys(userId) {
  const r = await pool.query('select count(*)::int as n from passkeys where user_id=$1', [userId]);
  return r.rows[0].n;
}

export async function registrationOptions(userId, userName, language) {
  const { rpID } = rpConfig();
  const existing = await pool.query('select id, transports from passkeys where user_id=$1', [userId]);
  const options = await generateRegistrationOptions({
    rpName: t(language, 'notify.appName'),
    rpID,
    userName,
    userDisplayName: t(language, 'notify.appName'),
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existing.rows.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  putChallenge(`reg:${userId}`, options.challenge);
  return options;
}

export async function registrationVerify(userId, response, name) {
  const expectedChallenge = takeChallenge(`reg:${userId}`);
  if (!expectedChallenge) throw Object.assign(new Error('challenge expired'), { code: 'challenge' });
  const { rpID, origins } = rpConfig();
  const v = await verifyRegistrationResponse({
    response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) throw Object.assign(new Error('not verified'), { code: 'verify' });
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  await pool.query(
    `insert into passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (id) do nothing`,
    [credential.id, userId, Buffer.from(credential.publicKey), credential.counter,
     credential.transports || [], credentialDeviceType, credentialBackedUp, name]
  );
  return { id: credential.id };
}

export async function authenticationOptions(userId, sessionKey, { discoverable = false } = {}) {
  const { rpID } = rpConfig();
  const existing = await pool.query('select id, transports from passkeys where user_id=$1', [userId]);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    // discoverable: no allow-list, the authenticator offers the passkeys it holds for this rpID
    ...(discoverable ? {} : { allowCredentials: existing.rows.map((p) => ({ id: p.id, transports: p.transports })) }),
  });
  putChallenge(`auth:${sessionKey}`, options.challenge);
  return options;
}

export async function authenticationVerify(userId, sessionKey, response) {
  const expectedChallenge = takeChallenge(`auth:${sessionKey}`);
  if (!expectedChallenge) throw Object.assign(new Error('challenge expired'), { code: 'challenge' });
  const r = await pool.query('select * from passkeys where id=$1 and user_id=$2', [response?.id, userId]);
  const pk = r.rows[0];
  if (!pk) throw Object.assign(new Error('unknown credential'), { code: 'unknown' });
  const { rpID, origins } = rpConfig();
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
    credential: { id: pk.id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
  });
  if (!v.verified) throw Object.assign(new Error('not verified'), { code: 'verify' });
  await pool.query('update passkeys set counter=$2, last_used_at=now() where id=$1', [pk.id, v.authenticationInfo.newCounter]);
  return { id: pk.id, name: pk.name };
}

export async function deletePasskey(userId, id) {
  const r = await pool.query('delete from passkeys where id=$1 and user_id=$2', [id, userId]);
  return r.rowCount > 0;
}
