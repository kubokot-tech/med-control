// Settings that decide where the data goes (the AI service and its keys, the Telegram bot and chat) need the password
// again, except for a few minutes after it was typed to sign in. lib/auth.js: sensitiveConfirmed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { SKIP, USER_ID, setupDb } from './helpers.js';

delete process.env.DTC_PASSWORD;
const PW = 'correct horse battery';
const BOT_1 = `1234567:${'A'.repeat(35)}`;
const BOT_2 = `7654321:${'B'.repeat(35)}`;

let db; let app; let realFetch; let telegram = []; let telegramDown = false;
before(async () => {
  if (SKIP) return;
  db = await setupDb('sensitive');
  // the helper fills these for other tests; here the bot and the keys come from the settings page
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PROXY', 'EGRESS_PROXY', 'LLM_PROVIDER', 'LLM_BASE_URL', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'YANDEX_API_KEY', 'YANDEX_FOLDER_ID']) delete process.env[k];
  const auth = await import('../../src/lib/auth.js');
  const { CoreError, HTTP_STATUS, errorBody } = await import('../../src/lib/errors.js');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
  app.decorate('authenticate', auth.authenticate);
  app.setErrorHandler((err, _req, reply) => (err instanceof CoreError ? reply.code(HTTP_STATUS[err.kind]).send(errorBody(err)) : reply.code(500).send({ error: 'internal', m: err.message })));
  await app.register((await import('../../src/routes/setup.js')).default);
  await app.register(auth.default);
  await app.register((await import('../../src/routes/ai.js')).default);
  await app.register((await import('../../src/routes/notify.js')).default);
  await app.register((await import('../../src/routes/locale.js')).default);
  // Telegram is not called for real: every request to it is recorded
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://api.telegram.org/')) return realFetch(url, init);
    if (telegramDown) throw new Error('fetch failed');
    telegram.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
after(async () => { if (realFetch) globalThis.fetch = realFetch; if (app) await app.close(); if (db) await db.teardown(); });

const put = (url, body, token, ip = '203.0.113.10') => app.inject({ method: 'PUT', url, payload: body, remoteAddress: ip, headers: { authorization: `Bearer ${token}` } });
const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const nowS = () => Math.floor(Date.now() / 1000);
/** A session as the gateway signs it; `pw`: when the password was typed (none: a sign-in by a passkey alone). */
const session = (pw) => app.jwt.sign({ sub: USER_ID, tz: 'Europe/Moscow', tv: 0, ...(pw ? { pw } : {}) }, { expiresIn: '30d' });
const aiStatus = async (token) => (await app.inject({ method: 'GET', url: '/ai/status', headers: { authorization: `Bearer ${token}` } })).json();

let fresh; // the wizard's session: the password was typed just now
test('right after the wizard (the password was just typed) AI and Telegram connect without asking again', { skip: SKIP }, async () => {
  const setup = await app.inject({ method: 'POST', url: '/setup', payload: { password: PW } });
  assert.equal(setup.statusCode, 200, setup.body);
  fresh = setup.json().token;
  assert.ok(Math.abs(claims(fresh).pw - nowS()) <= 5, 'the session carries the time the password was typed');

  const ai = await put('/ai/settings', { provider: 'openai', openaiApiKey: 'sk-test-first' }, fresh);
  assert.equal(ai.statusCode, 200, ai.body);
  assert.deepEqual([ai.json().provider, ai.json().enabled], ['openai', true]);
  const tg = await put('/notify/telegram', { token: BOT_1 }, fresh);
  assert.equal(tg.statusCode, 200, tg.body);
  assert.equal(tg.json().tokenSet, true);
});

test('a session without a typed password (a passkey sign-in, a stolen old token) cannot change the service, address or keys', { skip: SKIP }, async () => {
  const stolen = session(null);
  // what stays free: model names, the anamnesis, sending what is already set, removing a key that is not there
  assert.equal((await put('/ai/settings', { model: 'gpt-5-mini', modelFast: 'gpt-5-nano' }, stolen)).statusCode, 200);
  assert.equal((await put('/ai/settings', { anamnesis: 'Диагноз: пример.' }, stolen)).statusCode, 200);
  assert.equal((await put('/ai/settings', { provider: 'openai', model: 'gpt-5' }, stolen)).statusCode, 200, 'the same service again is no change');
  assert.equal((await put('/ai/settings', { deepseekApiKey: '' }, stolen)).statusCode, 200);

  for (const body of [{ provider: 'deepseek' }, { provider: 'custom', baseUrl: 'http://192.168.1.10:11434/v1', model: 'm' }, { baseUrl: 'https://collector.example/v1' }, { openaiApiKey: 'sk-somebody-else' }, { openaiApiKey: 'sk-test-first' }, { openaiApiKey: '' }, { deepseekApiKey: 'sk-new' }, { customApiKey: 'k' }, { yandexFolder: 'b1gabc' }, { provider: 'auto' }]) {
    const r = await put('/ai/settings', body, stolen);
    assert.equal(r.statusCode, 403, JSON.stringify(body));
    assert.equal(r.json().error, 'password_required', JSON.stringify(body));
  }
  let st = await aiStatus(stolen);
  assert.deepEqual([st.provider, st.model, st.customUrl, st.keySource.openai, st.keySource.deepseek], ['openai', 'gpt-5', null, 'settings', ''], 'nothing of it was written, not even the model sent along');

  // a bad field is refused as before, password or not
  assert.equal((await put('/ai/settings', { baseUrl: 'http://postgres:5432/' }, stolen)).json().error, 'bad_base_url');
  assert.equal((await put('/ai/settings', { provider: 'nobody' }, stolen)).json().error, 'bad_provider');

  // a wrong password is a guess; the right one lets the change through
  const wrong = await put('/ai/settings', { provider: 'deepseek', deepseekApiKey: 'sk-deep', model: 'deepseek-chat', password: 'not the password' }, stolen);
  assert.deepEqual([wrong.statusCode, wrong.json().error], [403, 'invalid_password']);
  assert.equal((await aiStatus(stolen)).provider, 'openai');
  const ok = await put('/ai/settings', { provider: 'deepseek', deepseekApiKey: 'sk-deep', model: 'deepseek-chat', password: PW }, stolen);
  assert.equal(ok.statusCode, 200, ok.body);
  st = await aiStatus(stolen);
  assert.deepEqual([st.provider, st.model, st.keySource.deepseek], ['deepseek', 'deepseek-chat', 'settings']);
});

test('the grace is fifteen minutes from the password and a token issued again does not renew it', { skip: SKIP }, async () => {
  const { passwordFresh, PASSWORD_GRACE_S } = await import('../../src/lib/auth.js');
  assert.equal(PASSWORD_GRACE_S, 900);
  assert.equal(passwordFresh({ pw: 1000 }, 1000 + 899), true);
  assert.equal(passwordFresh({ pw: 1000 }, 1000 + 900), false);
  assert.equal(passwordFresh({}, 1000), false, 'no password was typed for this session');
  assert.equal(passwordFresh({ pw: 'yes' }, 1000), false);
  assert.equal(passwordFresh({ iat: 1000 }, 1001), false, 'the time the token was issued is not the time of the password');

  const recent = session(nowS() - 14 * 60);
  const old = session(nowS() - 16 * 60);
  assert.equal((await put('/ai/settings', { yandexFolder: 'b1grecent' }, recent)).statusCode, 200);
  assert.equal((await put('/ai/settings', { yandexFolder: 'b1gold' }, old)).json().error, 'password_required');

  // a new time zone comes with a new token: the time of the password is copied, not moved to now
  const re = await put('/settings/locale', { timeZone: 'Asia/Tokyo' }, old);
  assert.equal(re.statusCode, 200, re.body);
  const reissued = re.json().token;
  assert.ok(reissued, 'a new token for the new zone');
  assert.equal(claims(reissued).pw, claims(old).pw);
  assert.ok(claims(reissued).iat >= nowS() - 5, 'the token itself is new');
  assert.equal((await put('/ai/settings', { yandexFolder: 'b1gold' }, reissued)).json().error, 'password_required');
  // and a session that never had the password does not get it this way
  const none = (await put('/settings/locale', { timeZone: 'Europe/Berlin' }, session(null))).json().token;
  assert.equal(claims(none).pw, undefined);
  assert.equal((await put('/ai/settings', { yandexFolder: 'b1gnone' }, none)).json().error, 'password_required');

  // signing in with the password starts it again; changing the password does too
  const login = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '203.0.113.20', payload: { password: PW } });
  assert.equal(login.statusCode, 200, login.body);
  assert.ok(Math.abs(claims(login.json().token).pw - nowS()) <= 5);
  assert.equal((await put('/ai/settings', { yandexFolder: 'b1glogin' }, login.json().token)).statusCode, 200);
});

test('asking without a password is not a guess; wrong passwords are counted per address', { skip: SKIP }, async () => {
  const stolen = session(null);
  for (let i = 0; i < 12; i += 1) assert.equal((await put('/ai/settings', { provider: 'openai' }, stolen, '203.0.113.30')).json().error, 'password_required');
  assert.equal((await put('/ai/settings', { provider: 'openai', password: PW }, stolen, '203.0.113.30')).statusCode, 200, 'twelve questions locked nothing');
  for (let i = 0; i < 5; i += 1) assert.equal((await put('/ai/settings', { provider: 'deepseek', password: `wrong guess ${i}` }, stolen, '203.0.113.31')).json().error, 'invalid_password');
  const locked = await put('/ai/settings', { provider: 'deepseek', password: PW }, stolen, '203.0.113.31');
  assert.deepEqual([locked.statusCode, locked.json().error], [429, 'too_many_attempts'], 'five wrong ones lock the address');
  assert.equal((await put('/ai/settings', { provider: 'deepseek', password: PW }, stolen, '203.0.113.32')).statusCode, 200, 'the owner elsewhere is not held up');
});

test('Telegram: the bot and the chat need the password, and the chat that loses the messages is told first', { skip: SKIP }, async () => {
  const stolen = session(null);
  const { telegramConfig } = await import('../../src/lib/telegram.js');
  for (const body of [{ chatId: '222' }, { token: BOT_2 }, { token: BOT_1 }, { token: '' }, { token: BOT_2, chatId: '999' }]) {
    const r = await put('/notify/telegram', body, stolen, '203.0.113.40');
    assert.deepEqual([r.statusCode, r.json().error], [403, 'password_required'], JSON.stringify(body));
  }
  assert.equal((await put('/notify/telegram', { chatId: '' }, stolen, '203.0.113.40')).statusCode, 200, 'clearing a chat that is not set asks for nothing');
  assert.equal((await put('/notify/telegram', { chatId: 'not a number', password: PW }, stolen, '203.0.113.40')).json().error, 'bad_chat_id');
  assert.equal((await put('/notify/telegram', { chatId: '222', password: 'not the password' }, stolen, '203.0.113.40')).json().error, 'invalid_password');
  assert.deepEqual([telegramConfig().token, telegramConfig().chatId], [BOT_1, ''], 'refused requests changed nothing');

  // the first chat: nobody to tell yet
  telegram = [];
  const first = await put('/notify/telegram', { chatId: '222', password: PW }, stolen, '203.0.113.40');
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().ready, true);
  assert.equal(telegram.length, 0);

  // the same chat again: no notice
  assert.equal((await put('/notify/telegram', { chatId: '222', password: PW }, stolen, '203.0.113.40')).statusCode, 200);
  assert.equal(telegram.length, 0);

  // another chat: the old chat hears about it, through the old bot, before the change
  const moved = await put('/notify/telegram', { chatId: '333', password: PW }, stolen, '203.0.113.40');
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(telegram.length, 1);
  assert.equal(telegram[0].url, `https://api.telegram.org/bot${BOT_1}/sendMessage`);
  assert.equal(telegram[0].body.chat_id, '222');
  assert.match(telegram[0].body.text, /изменены бот или чат Telegram/);
  assert.equal(telegramConfig().chatId, '333');

  // another bot: the present chat hears about it through the bot it knows
  telegram = [];
  assert.equal((await put('/notify/telegram', { token: BOT_2, password: PW }, stolen, '203.0.113.40')).statusCode, 200);
  assert.deepEqual([telegram.length, telegram[0].url, telegram[0].body.chat_id], [1, `https://api.telegram.org/bot${BOT_1}/sendMessage`, '333']);
  assert.equal(telegramConfig().token, BOT_2);

  // Telegram unreachable: the notice is best effort, the settings are saved all the same
  telegram = []; telegramDown = true;
  try {
    const r = await put('/notify/telegram', { chatId: '444', password: PW }, stolen, '203.0.113.40');
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(telegramConfig().chatId, '444');
  } finally { telegramDown = false; }

  // inside the grace no password is asked, the notice goes all the same
  telegram = [];
  assert.equal((await put('/notify/telegram', { chatId: '555' }, session(nowS() - 60), '203.0.113.40')).statusCode, 200);
  assert.deepEqual([telegram.length, telegram[0].body.chat_id], [1, '444']);
});

test('a value set in .env still cannot be changed from the settings page', { skip: SKIP }, async () => {
  process.env.TELEGRAM_CHAT_ID = '111'; process.env.OPENAI_API_KEY = 'sk-env';
  try {
    assert.deepEqual([(await put('/notify/telegram', { chatId: '666', password: PW }, session(null))).statusCode, (await put('/ai/settings', { openaiApiKey: 'sk-x', password: PW }, session(null))).statusCode], [409, 409]);
  } finally { delete process.env.TELEGRAM_CHAT_ID; delete process.env.OPENAI_API_KEY; }
});

test('desktop edition: a local model on 127.0.0.1 connects after signing in with the password, and later with it', { skip: SKIP }, async () => {
  process.env.DTC_EDITION = 'desktop';
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/edition' })).json().edition, 'desktop');
    const login = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '127.0.0.1', payload: { password: PW } });
    assert.equal(login.statusCode, 200, login.body);
    const local = { provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:14b', modelFast: 'qwen3:14b' };
    const ok = await put('/ai/settings', local, login.json().token, '127.0.0.1');
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual([ok.json().provider, ok.json().enabled, ok.json().model], ['custom', true, 'qwen3:14b']);
    // the same form saved again with another model: nothing sensitive changes, no password
    const later = session(nowS() - 3600);
    assert.equal((await put('/ai/settings', { ...local, model: 'llama3.3', modelFast: 'llama3.3' }, later, '127.0.0.1')).statusCode, 200);
    // another address: the password, which the desktop edition has like the server one
    assert.equal((await put('/ai/settings', { ...local, baseUrl: 'http://127.0.0.1:1234/v1' }, later, '127.0.0.1')).json().error, 'password_required');
    assert.equal((await put('/ai/settings', { ...local, baseUrl: 'http://127.0.0.1:1234/v1', password: PW }, later, '127.0.0.1')).statusCode, 200);
    assert.equal((await aiStatus(later)).customUrl, 'http://127.0.0.1:1234/v1');
  } finally { delete process.env.DTC_EDITION; }
  assert.equal((await aiStatus(session(null))).customUrl, null, 'on the server the same address is not accepted: loopback is the gateway itself');
});
