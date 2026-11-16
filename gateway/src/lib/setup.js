/**
 * First-run wizard. There is one user, so the only credential is the password: DTC_PASSWORD in .env or, when .env has
 * none, a scrypt hash in app_settings written by the wizard. The account name below is internal, nobody types it.
 */
import { z } from 'zod';
import { pool } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { safeEqual } from './loginGuard.js';
import { hashPassword, verifyPassword, passwordProblem, envPasswordState } from './password.js';
import { storeSecret } from './config.js';
import { isValidTz } from './dates.js';
import { protocolFromPreset, setProtocol } from './protocol.js';
import { normalizeLanguage, normalizePrefs } from '../../../shared/format.js';

const ENV_PASSWORD = process.env.DTC_PASSWORD || '';
// A password in .env is judged by the rule it was accepted under (an existing install must keep starting); one that
// the present rule would refuse only gets a warning in the log (server.js).
const ENV_PASSWORD_STATE = envPasswordState(ENV_PASSWORD);
if (ENV_PASSWORD_STATE.fatal) throw new Error(ENV_PASSWORD_STATE.fatal);
export const ENV_PASSWORD_WARNING = ENV_PASSWORD_STATE.warning;
export const DEFAULT_LOGIN = 'admin';
export const USER_ID = '00000000-0000-0000-0000-000000000001';

/** The internal account name: passkeys need one. Older installs keep the login they chose in the wizard. */
export function currentLogin() { return getSetting('auth_login') || DEFAULT_LOGIN; }
/** 'env' | 'settings' | 'none' */
export function credentialsSource() { return ENV_PASSWORD ? 'env' : getSetting('auth_password_hash') ? 'settings' : 'none'; }
export function setupNeeded() { return credentialsSource() === 'none'; }

export function checkPassword(password) {
  if (ENV_PASSWORD) return safeEqual(password, ENV_PASSWORD);
  const h = getSetting('auth_password_hash');
  return h ? verifyPassword(password, h) : false;
}

export const SetupBody = z.object({
  password: z.string().min(1).max(200),
  tz: z.string().trim().max(64).optional(),
  region: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
  openrouterApiKey: z.string().trim().max(300).optional(),
  anthropicApiKey: z.string().trim().max(300).optional(),
  telegramBotToken: z.string().trim().max(300).optional(),
  telegramChatId: z.string().trim().max(64).optional(),
  preset: z.string().trim().max(40).optional(),
  setupCode: z.string().max(40).optional(), // checked by the route (lib/setupCode.js)
});

/** Change the wizard password. Throws { code }: set_in_env, invalid_password, weak_password, same_password. */
export async function changePassword(current, next) {
  if (credentialsSource() === 'env') { const e = new Error('password is in .env'); e.code = 'set_in_env'; throw e; }
  if (!checkPassword(String(current || ''))) { const e = new Error('wrong password'); e.code = 'invalid_password'; throw e; }
  if (passwordProblem(next)) { const e = new Error('weak password'); e.code = 'weak_password'; throw e; }
  if (String(next) === String(current)) { const e = new Error('same password'); e.code = 'same_password'; throw e; }
  await setSetting('auth_password_hash', hashPassword(next));
}

/** Writes everything the wizard collected. Throws { code } on validation problems; the route maps codes to HTTP. */
export async function completeSetup(input) {
  if (!setupNeeded()) { const e = new Error('setup already done'); e.code = 'setup_done'; throw e; }
  const b = SetupBody.parse(input);
  const problem = passwordProblem(b.password);
  if (problem) { const e = new Error('weak password'); e.code = 'weak_password'; throw e; }
  const tz = b.tz || 'Europe/Moscow';
  if (!isValidTz(tz)) { const e = new Error('bad timezone'); e.code = 'bad_timezone'; throw e; }
  if (b.preset && !protocolFromPreset(b.preset)) { const e = new Error('preset not found'); e.code = 'preset_not_found'; throw e; }

  await setSetting('auth_password_hash', hashPassword(b.password));
  // An unknown region falls back to the default; it can be changed later in Settings → «Язык и регион».
  await pool.query('update users set email = $2, timezone = $3, prefs = $4, locale = $5 where id = $1', [USER_ID, DEFAULT_LOGIN, tz, normalizePrefs({ region: b.region }), normalizeLanguage(b.language)]);
  for (const k of ['openrouterApiKey', 'anthropicApiKey', 'telegramBotToken', 'telegramChatId']) if (b[k]) await storeSecret(k, b[k]);
  if (b.preset) await setProtocol(protocolFromPreset(b.preset));
  return { tz };
}
