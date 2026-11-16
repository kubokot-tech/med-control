/** A security message to the owner's Telegram in the owner's language. Best effort: it never fails the request. */
import { telegramReady, sendTelegram } from './telegram.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

export async function notifyUser(userId, key, args) {
  if (!telegramReady()) return;
  try { await sendTelegram(t(await userLanguage(userId), `notify.${key}`, args)); } catch { /* the action itself succeeded */ }
}
