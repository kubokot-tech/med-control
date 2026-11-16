/**
 * Secrets and settings that may come from .env or from the first-run wizard (app_settings).
 * .env always wins so an existing installation keeps working; the wizard fills app_settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getSetting, setSetting } from './settings.js';

export const DATA_DIR = process.env.DTC_DATA_DIR || '/data';

const SECRETS = {
  openrouterApiKey: ['OPENROUTER_API_KEY', 'cfg_openrouter_api_key'],
  anthropicApiKey: ['ANTHROPIC_API_KEY', 'cfg_anthropic_api_key'],
  openaiApiKey: ['OPENAI_API_KEY', 'cfg_openai_api_key'],
  deepseekApiKey: ['DEEPSEEK_API_KEY', 'cfg_deepseek_api_key'],
  yandexApiKey: ['YANDEX_API_KEY', 'cfg_yandex_api_key'],
  gigachatAuthKey: ['GIGACHAT_AUTH_KEY', 'cfg_gigachat_auth_key'],
  customApiKey: ['LLM_CUSTOM_API_KEY', 'cfg_custom_api_key'],
  telegramBotToken: ['TELEGRAM_BOT_TOKEN', 'cfg_telegram_bot_token'],
  telegramChatId: ['TELEGRAM_CHAT_ID', 'cfg_telegram_chat_id'],
};

/** app_settings keys that hold secrets (and the Telegram chat id): never exported. */
export const SECRET_SETTING_KEYS = new Set(Object.values(SECRETS).map(([, key]) => key));
/** Secret by the list above or by name, so a key added later without updating the list is still kept out. */
export const isSecretSetting = (key) => SECRET_SETTING_KEYS.has(key) || /token|secret|api_key|auth_key|password|_hash$/i.test(String(key));

export function secret(name) {
  const [env, key] = SECRETS[name];
  return process.env[env] || getSetting(key) || '';
}
/** 'env' | 'settings' | '' */
export function secretSource(name) {
  const [env, key] = SECRETS[name];
  return process.env[env] ? 'env' : getSetting(key) ? 'settings' : '';
}
export async function storeSecret(name, value) {
  const [, key] = SECRETS[name];
  await setSetting(key, String(value || '').trim());
}

const WEAK_JWT = /^(change_me|changeme|secret|dev)$/i;
/** JWT_SECRET from .env when set (must be strong), otherwise a generated one persisted in DATA_DIR. */
export function resolveJwtSecret() {
  const env = process.env.JWT_SECRET;
  if (env) {
    if (env.length < 32 || WEAK_JWT.test(env)) throw new Error('JWT_SECRET must be a random string of at least 32 characters (openssl rand -base64 48)');
    return env;
  }
  const file = path.join(DATA_DIR, 'jwt.secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* not created yet */ }
  const s = randomBytes(48).toString('base64');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, s + '\n', { mode: 0o600 });
  return s;
}
