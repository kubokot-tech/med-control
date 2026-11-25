import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

let db, bot, out;
before(async () => {
  if (SKIP) return;
  db = await setupDb('bot');
  await seedRegimen(db.pool);
  const { createTelegramBot } = await import('../../src/lib/telegramBot.js');
  out = { sent: [], edited: [], answered: [] };
  bot = createTelegramBot({
    userId: USER_ID, log: db.quiet,
    fetchImpl: async () => { throw new Error('network must not be used'); },
    tg: { send: async (text, chat, extra) => { out.sent.push({ text, extra }); }, edit: async (chat, id, text) => { out.edited.push(text); }, answer: async (id, text) => { out.answered.push(text); } },
  });
});
after(async () => { if (db) await db.teardown(); });

const CHAT = process.env.TELEGRAM_CHAT_ID || '111';
const msg = (text, chat = CHAT) => ({ chat: { id: chat }, from: { username: 'u' }, text });

test('messages from other chats are ignored', { skip: SKIP }, async () => {
  await bot.handle(msg('принял', '999'));
  assert.equal(out.sent.length, 0);
});

test('«принял» records today once; «статус» reports it', { skip: SKIP }, async () => {
  await bot.handle(msg('принял'));
  assert.match(out.sent.at(-1).text, /Ленватиниб 24 мг сегодня принят/);
  await bot.handle(msg('принял'));
  assert.match(out.sent.at(-1).text, /уже отмечен: принят/);
  await bot.handle(msg('статус'));
  assert.match(out.sent.at(-1).text, /Ленватиниб: принят/);
  const n = await db.pool.query('select count(*)::int as n from administrations where user_id=$1', [USER_ID]);
  assert.equal(n.rows[0].n, 1);
});

test('unknown text gets the help, photos get the PDF hint', { skip: SKIP }, async () => {
  await bot.handle(msg('привет'));
  assert.match(out.sent.at(-1).text, /Я умею/);
  await bot.handle({ chat: { id: CHAT }, photo: [{}] });
  assert.match(out.sent.at(-1).text, /только PDF/);
});

test('dose button for a past day records it and edits the message', { skip: SKIP }, async () => {
  await bot.handleCallback({ id: 'cq1', data: 'dose:SKIPPED:2026-03-01', message: { chat: { id: CHAT }, message_id: 5, text: 'напоминание' } });
  assert.match(out.answered.at(-1), /пропущен/);
  assert.match(out.edited.at(-1), /^напоминание\n\nОтмечено: Ленватиниб 2026-03-01 пропущен/);
  const r = await db.pool.query(`select status, day::text as day from administrations where user_id=$1 and day='2026-03-01'`, [USER_ID]);
  assert.deepEqual(r.rows, [{ status: 'SKIPPED', day: '2026-03-01' }]);
  await bot.handleCallback({ id: 'cq2', data: 'dose:TAKEN:2026-03-01', message: { chat: { id: CHAT }, message_id: 5, text: 'напоминание' } });
  assert.match(out.answered.at(-1), /уже отмечен/);
});

test('diary one-liner is saved for today and answered with a summary', { skip: SKIP }, async () => {
  await bot.handle(msg('давление 150/95, усталость 2, вес 116.5, заметка: гулял'));
  assert.match(out.sent.at(-1).text, /Дневник за сегодня: АД 150\/95 · 116\.5 кг · усталость 2/);
  assert.match(out.sent.at(-1).text, /тревога/i, 'BP 150/95 raises a YELLOW alert');
  const r = await db.pool.query('select bp_sys, bp_dia, weight_kg::float as w, fatigue, notes from symptom_entries where user_id=$1', [USER_ID]);
  assert.deepEqual(r.rows, [{ bp_sys: 150, bp_dia: 95, w: 116.5, fatigue: 2, notes: 'гулял' }]);
  const ev = await db.pool.query(`select count(*)::int as n from events where user_id=$1 and type='SYMPTOM'`, [USER_ID]);
  assert.equal(ev.rows[0].n, 1);
});

test('support medication: «принял левотироксин» records that drug, status lists both', { skip: SKIP }, async () => {
  const m = await db.pool.query(`insert into medications (user_id, name, role, instructions) values ($1, 'Левотироксин натрия', 'support', 'натощак') returning id`, [USER_ID]);
  const r = await db.pool.query(`insert into regimens (user_id, name, start_date) values ($1, 'Левотироксин', '2026-03-01') returning id`, [USER_ID]);
  await db.pool.query(`insert into regimen_items (regimen_id, medication_id, dose_value, dose_unit, route, frequency_rule, time_windows, prn, remind_at) values ($1, $2, 125, 'мкг', 'po', 'DAILY', '{}'::jsonb, false, '07:30')`, [r.rows[0].id, m.rows[0].id]);
  await bot.handle(msg('принял левотироксин'));
  assert.match(out.sent.at(-1).text, /Левотироксин натрия 125 мкг сегодня принят/);
  await bot.handle(msg('статус'));
  assert.match(out.sent.at(-1).text, /💊 Ленватиниб: принят\n▫️ Левотироксин натрия: принят/);
  await bot.handle(msg('принял чтототам'));
  assert.match(out.sent.at(-1).text, /Не нашёл препарат/);
});

test('«принял» lands on today of the user\'s own time zone, not Moscow\'s', { skip: SKIP }, async () => {
  const { todayKey } = await import('../../src/lib/dates.js');
  // a zone whose date differs from Moscow's right now (one of the two always does)
  const zone = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find((z) => todayKey(z) !== todayKey('Europe/Moscow'));
  await db.pool.query('update users set timezone = $2 where id = $1', [USER_ID, zone]);
  try {
    await bot.handle(msg('принял'));
    assert.match(out.sent.at(-1).text, /сегодня принят/, 'not «already marked»: Moscow\'s mark is another day there');
    const r = await db.pool.query(`select day::text as day from administrations where user_id = $1 order by created_at desc limit 1`, [USER_ID]);
    assert.equal(r.rows[0].day, todayKey(zone));
  } finally {
    await db.pool.query(`update users set timezone = 'Europe/Moscow' where id = $1`, [USER_ID]);
  }
});

test('rotating the chat invalidates the previous handler before it can use the transport or write a dose', { skip: SKIP }, async () => {
  const before = await db.pool.query('select count(*) as n from administrations');
  const sent = out.sent.length;
  const answered = out.answered.length;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  try {
    process.env.TELEGRAM_CHAT_ID = '222';
    await bot.handle(msg('принял'));
    await bot.handleCallback({ id: 'stale', data: 'dose:SKIPPED:2026-03-03', message: { chat: { id: CHAT }, message_id: 1 } });
    assert.equal(out.sent.length, sent);
    assert.equal(out.answered.length, answered);
    assert.deepEqual((await db.pool.query('select count(*) as n from administrations')).rows, before.rows);
  } finally {
    process.env.TELEGRAM_CHAT_ID = previousChat;
  }
});

test('switching Telegram credentials aborts the old poll and starts a new poll with its bot offset', { skip: SKIP }, async () => {
  const { startTelegramBot, ensureTelegramBot } = await import('../../src/lib/telegramBot.js');
  const { setSetting } = await import('../../src/lib/settings.js');
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const polls = [];
  const fetchImpl = async (url, init) => {
    polls.push({ url, signal: init.signal, offset: JSON.parse(init.body).offset });
    await new Promise((resolve) => init.signal.addEventListener('abort', resolve, { once: true }));
    return { ok: true, json: async () => ({ ok: true, result: [] }) };
  };
  process.env.TELEGRAM_BOT_TOKEN = '10001:synthetic';
  process.env.TELEGRAM_CHAT_ID = '100';
  await setSetting('tg_offset_10001', '17');
  const stop = startTelegramBot({ userId: USER_ID, log: db.quiet, fetchImpl });
  try {
    assert.equal(polls[0].offset, 17);
    process.env.TELEGRAM_BOT_TOKEN = '10002:synthetic';
    process.env.TELEGRAM_CHAT_ID = '200';
    await ensureTelegramBot();
    assert.equal(polls.length, 2);
    assert.equal(polls[0].signal.aborted, true);
    assert.match(polls[1].url, /bot10002:/);
    assert.equal(polls[1].offset, 0);
    process.env.TELEGRAM_CHAT_ID = '';
    await ensureTelegramBot();
    assert.equal(polls[1].signal.aborted, true);
    assert.equal(polls.length, 2);
  } finally {
    await stop();
    process.env.TELEGRAM_CHAT_ID = oldChat;
    process.env.TELEGRAM_BOT_TOKEN = oldToken;
  }
});
