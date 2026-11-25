import { pool } from '../lib/db.js';
import { telegramConfig, telegramReady, sendTelegram, discoverChats, botInfo } from '../lib/telegram.js';
import { backupStatus, backupLine } from '../lib/backupStatus.js';
import { secretSource, storeSecret } from '../lib/config.js';
import { updateAuthSettings } from '../lib/settings.js';
import { ensureTelegramBot } from '../lib/telegramBot.js';
import { reminderTimes, saveReminderTimes } from '../lib/reminderTimes.js';
import { userFormat, userLanguage } from '../lib/userLocale.js';
import { t } from '../lib/i18n.js';
import { sensitiveConfirmed } from '../lib/auth.js';
import { requireFeature, available } from '../lib/edition.js';

export default async function notifyRoutes(app) {
  app.get('/notify/status', { preHandler: app.authenticate }, async (req) => {
    const c = telegramConfig();
    let bot = null;
    if (c.token && available('telegram')) { try { const b = await botInfo(); bot = { username: b.username, name: b.first_name }; } catch { bot = null; } }
    const last = await pool.query('select kind, ref, sent_at, text from notifications where user_id = $1 order by sent_at desc limit 10', [req.user.sub]);
    const labs = await pool.query('select max(collected_at) as last from lab_results where user_id = $1', [req.user.sub]);
    const lastLab = labs.rows[0]?.last ? new Date(labs.rows[0].last) : null;
    return {
      telegram: { tokenSet: Boolean(c.token), chatSet: Boolean(c.chatId), ready: telegramReady(), bot, tokenSource: secretSource('telegramBotToken'), chatSource: secretSource('telegramChatId') },
      schedule: reminderTimes(),
      lastLabAt: lastLab && !Number.isNaN(lastLab.getTime()) ? lastLab.toISOString() : null,
      appUrl: c.appUrl,
      recent: last.rows,
      backup: await userFormat(req.user.sub).then(async (f) => { const b = await backupStatus(f.language); return b ? { ...b, line: backupLine(b, f) } : null; }),
      // the folder on the server as set in .env (compose passes it): the backup card says where the copies are
      backupDir: process.env.BACKUP_DIR_SHOWN || null,
    };
  });

  // Reminder times (lib/reminderTimes.js); a value fixed in .env is refused
  app.put('/notify/schedule', { preHandler: app.authenticate }, async (req) => ({ schedule: await saveReminderTimes(req.body || {}) }));

  // Token and chat id from the settings page (stored in app_settings); values in .env win and cannot be changed here.
  // The bot and the chat receive reminders and security notices and can write into the diary, so changing them needs
  // the password (or a session that typed it minutes ago): a stolen session token must not move them to another chat.
  app.put('/notify/telegram', { preHandler: app.authenticate }, async (req, reply) => {
    requireFeature('telegram');
    const b = req.body || {};
    const next = {};
    if ('token' in b) {
      if (secretSource('telegramBotToken') === 'env') return reply.code(409).send({ error: 'set_in_env' });
      next.token = String(b.token || '').trim();
      if (next.token && !/^\d{5,15}:[A-Za-z0-9_-]{20,100}$/.test(next.token)) return reply.code(400).send({ error: 'bad_token' });
    }
    if ('chatId' in b) {
      if (secretSource('telegramChatId') === 'env') return reply.code(409).send({ error: 'set_in_env' });
      next.chatId = String(b.chatId || '').trim();
      if (next.chatId && !/^-?\d{1,20}$/.test(next.chatId)) return reply.code(400).send({ error: 'bad_chat_id' });
    }
    // a value in the request always counts (comparing it with the stored one would tell a guess from the token);
    // only clearing what is already empty asks for nothing
    const was = telegramConfig();
    const sensitive = ('token' in next && (next.token || was.token)) || ('chatId' in next && (next.chatId || was.chatId));
    if (sensitive && !(await sensitiveConfirmed(req, reply))) return reply;
    // The chat that is about to stop receiving messages hears about it first, through the bot it knows: if somebody
    // else is moving the notifications away, this is the owner's only sign. Best effort and short: Telegram being
    // unreachable must not keep the settings from being saved.
    const changed = ('token' in next && next.token !== was.token) || ('chatId' in next && next.chatId !== was.chatId);
    if (changed && was.token && was.chatId) {
      const notice = sendTelegram(t(await userLanguage(req.user.sub), 'notify.telegramChanged')).catch((e) => { req.log.warn({ err: e?.message }, 'telegram: the notice to the previous chat was not sent'); });
      await Promise.race([notice, new Promise((r) => { setTimeout(r, 5000).unref(); })]);
    }
    await updateAuthSettings(async (_client, set) => {
      if ('token' in next) await storeSecret('telegramBotToken', next.token, set);
      if ('chatId' in next) await storeSecret('telegramChatId', next.chatId, set);
    });
    await ensureTelegramBot();
    return { ok: true, tokenSet: Boolean(telegramConfig().token), chatSet: Boolean(telegramConfig().chatId), ready: telegramReady() };
  });

  app.get('/notify/telegram/discover', { preHandler: app.authenticate }, async (req, reply) => {
    requireFeature('telegram');
    try {
      return { chats: await discoverChats() };
    } catch (e) {
      return reply.code(e.code === 'no_token' ? 503 : 502).send({ error: e.code || 'telegram', message: e.message });
    }
  });

  app.post('/notify/test', { preHandler: app.authenticate }, async (req, reply) => {
    requireFeature('telegram');
    const c = telegramConfig();
    const chatId = req.body?.chatId ? String(req.body.chatId) : undefined;
    if (chatId && c.chatId && chatId !== c.chatId) return reply.code(403).send({ error: 'chat_not_allowed' });
    try {
      await sendTelegram(t(await userLanguage(req.user.sub), 'notify.connected'), chatId);
      await pool.query('insert into notifications (user_id, kind, ref, text) values ($1,$2,$3,$4) on conflict do nothing', [req.user.sub, 'test', new Date().toISOString(), 'test']);
      return { ok: true };
    } catch (e) {
      return reply.code(e.code === 'no_token' || e.code === 'no_chat' ? 503 : 502).send({ error: e.code || 'telegram', message: e.message });
    }
  });
}
