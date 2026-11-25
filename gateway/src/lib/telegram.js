/** Telegram Bot API: one chat, plain sendMessage. Token and chat id from .env or the first-run wizard (config.js). */
import { telegramFetch, telegramProxy } from './egress.js';
import { secret } from './config.js';
import { available } from './edition.js';

export function telegramConfig() {
  return {
    token: secret('telegramBotToken'),
    chatId: secret('telegramChatId'),
    appUrl: (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, ''),
  };
}
export function telegramReady() {
  // One gate for every caller (notifyUser, scheduler, bot, settings summary): an edition without Telegram
  // stays silent even when a token arrives with a database copied from another edition.
  if (!available('telegram')) return false;
  const c = telegramConfig();
  return Boolean(c.token && c.chatId);
}

async function call(method, body) {
  const { token } = telegramConfig();
  if (!token) { const e = new Error('TELEGRAM_BOT_TOKEN is not set'); e.code = 'no_token'; throw e; }
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(20_000) };
  let r;
  try { r = await telegramFetch(`https://api.telegram.org/bot${token}/${method}`, init); }
  catch (e) {
    // the proxy rides the router's VPN; when that is down, try the direct route (works where Telegram is not blocked)
    if (!telegramProxy()) throw e;
    r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { ...init, signal: AbortSignal.timeout(20_000) });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { const e = new Error(j.description || `telegram ${method} failed (${r.status})`); e.code = 'telegram'; throw e; }
  return j.result;
}

export async function sendTelegram(text, chatId, extra = {}) {
  const { chatId: defaultChat } = telegramConfig();
  const chat = chatId || defaultChat;
  if (!chat) { const e = new Error('TELEGRAM_CHAT_ID is not set'); e.code = 'no_chat'; throw e; }
  return call('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
/** Inline keyboard: rows of [{ text, data }]. */
export function keyboard(rows) {
  return { reply_markup: { inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } };
}
export async function editTelegram(chatId, messageId, text) {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}
export async function answerCallback(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text: text || undefined });
}

const seenChats = new Map();
let seenToken;
function selectChatCache(token) {
  if (token !== seenToken) {
    seenChats.clear();
    seenToken = token;
  }
}
function chatEntry(chat) {
  return { id: String(chat.id), name: [chat.first_name, chat.last_name, chat.title, chat.username && `@${chat.username}`].filter(Boolean).join(' ') };
}
/** Remember chats seen by the polling bot (it consumes updates, so getUpdates here would be empty). */
export function noteChats(chats, token = telegramConfig().token) {
  if (token !== telegramConfig().token) return;
  selectChatCache(token);
  for (const c of chats) if (c) seenChats.set(String(c.id), chatEntry(c));
}

/** Chats that wrote to the bot recently (to find your chat id during setup). */
export async function discoverChats() {
  const { token } = telegramConfig();
  selectChatCache(token);
  if (!telegramReady()) {
    const updates = await call('getUpdates', { limit: 50 });
    for (const u of updates) noteChats([u.message?.chat || u.edited_message?.chat || u.my_chat_member?.chat], token);
  }
  return Array.from(seenChats.values());
}

export async function botInfo() {
  return call('getMe', {});
}
