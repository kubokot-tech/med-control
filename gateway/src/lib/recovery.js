/**
 * Password recovery code: the only way back in when the wizard password is forgotten (no e-mail, no admin on the
 * desktop). Issued by the wizard and shown once; only its scrypt hash is stored. Using it sets a new password and
 * replaces the code. Not used when the password lives in .env (the server admin changes it there).
 */
import { randomInt } from 'node:crypto';
import { getSetting, updateAuthSettings } from './settings.js';
import { hashPassword, verifyPassword, passwordProblem } from './password.js';
import { credentialsSource, USER_ID } from './setup.js';

// Crockford base32: no I, L, O, U; 20 characters = 100 bits
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 20;
const fail = (code) => Object.assign(new Error(code), { code });

/** «7K3M-Q9TR-…»: groups of four for writing down. */
export function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < LENGTH; i += 1) s += ALPHABET[randomInt(ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}

/** What the user typed → the canonical form: case, spaces and dashes do not matter, O/I/L read as 0/1/1. */
export function normalizeRecoveryCode(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** A fresh code; the previous one stops working. */
export async function issueRecoveryCode() {
  return updateAuthSettings((_client, set) => replaceRecoveryCode(set));
}

async function replaceRecoveryCode(set) {
  const code = newRecoveryCode();
  await set('auth_recovery_hash', hashPassword(normalizeRecoveryCode(code)));
  await set('auth_recovery_created', new Date().toISOString());
  return code;
}

export function recoveryStatus() {
  if (credentialsSource() !== 'settings') return { applicable: false, exists: false, createdAt: null };
  return { applicable: true, exists: Boolean(getSetting('auth_recovery_hash')), createdAt: getSetting('auth_recovery_created') || null };
}

/**
 * New password by the recovery code. Returns the replacement code. Throws { code }: set_in_env, no_recovery_code,
 * invalid_recovery_code, weak_password.
 */
export async function recoverPassword(code, next) {
  if (credentialsSource() === 'env') throw fail('set_in_env');
  const h = getSetting('auth_recovery_hash');
  if (!h) throw fail('no_recovery_code');
  const typed = normalizeRecoveryCode(code);
  if (typed.length !== LENGTH || !verifyPassword(typed, h)) throw fail('invalid_recovery_code');
  if (passwordProblem(next)) throw fail('weak_password');
  return updateAuthSettings(async (client, set) => {
    const current = await client.query("select value from app_settings where key='auth_recovery_hash' for update");
    if (current.rows[0]?.value !== h) throw fail('invalid_recovery_code');
    const replacement = await replaceRecoveryCode(set);
    await set('auth_password_hash', hashPassword(next));
    const version = await client.query("select value from app_settings where key='token_version' for update");
    await set('token_version', String(Number(version.rows[0]?.value || 0) + 1));
    await set('integration_token_hash', '');
    await set('integration_token_created', '');
    await client.query('update mcp_tokens set revoked_at=now() where user_id=$1 and revoked_at is null', [USER_ID]);
    return replacement;
  });
}
