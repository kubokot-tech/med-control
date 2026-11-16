import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

delete process.env.DTC_PASSWORD;
delete process.env.OPENROUTER_API_KEY; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;

let db;
before(async () => { if (!SKIP) db = await setupDb('setup'); });
after(async () => { if (db) await db.teardown(); });

test('first-run wizard: needed until completed, then login works from the stored hash and secrets come from settings', { skip: SKIP }, async () => {
  const s = await import('../../src/lib/setup.js');
  const { secret, secretSource } = await import('../../src/lib/config.js');
  const { telegramReady } = await import('../../src/lib/telegram.js');
  const { getProtocol } = await import('../../src/lib/protocol.js');

  assert.equal(s.setupNeeded(), true);
  assert.equal(s.credentialsSource(), 'none');
  assert.equal(s.checkPassword('anything'), false);
  await assert.rejects(() => s.completeSetup({ password: 'password' }), (e) => e.code === 'weak_password');
  await assert.rejects(() => s.completeSetup({ password: 'correct horse battery', tz: 'Mars/Olympus' }), (e) => e.code === 'bad_timezone');
  assert.equal(s.setupNeeded(), true, 'a rejected attempt stores nothing');

  const r = await s.completeSetup({ password: 'correct horse battery', tz: 'Europe/Berlin', region: 'DE', openrouterApiKey: 'sk-or-test', telegramBotToken: '123:abc', telegramChatId: '42', preset: 'generic' });
  assert.deepEqual(r, { tz: 'Europe/Berlin' });
  assert.equal(s.setupNeeded(), false);
  assert.equal(s.credentialsSource(), 'settings');
  assert.equal(s.currentLogin(), s.DEFAULT_LOGIN, 'the account name is internal, nobody chooses it');
  assert.equal(s.checkPassword('correct horse battery'), true);
  assert.equal(s.checkPassword('wrong'), false);
  const u = await db.pool.query('select email, timezone, prefs from users where id = $1', [USER_ID]);
  assert.deepEqual(u.rows[0], { email: s.DEFAULT_LOGIN, timezone: 'Europe/Berlin', prefs: { region: 'DE', dateFormat: 'auto', hourCycle: 'auto', weekStart: 'auto', labUnits: 'auto', temperature: 'auto', weight: 'auto' } });
  assert.equal(secret('openrouterApiKey'), 'sk-or-test');
  assert.equal(secretSource('openrouterApiKey'), 'settings');
  assert.equal(secret('anthropicApiKey'), '');
  assert.equal(telegramReady(), true);
  assert.equal(getProtocol().preset, 'generic');
  await assert.rejects(() => s.completeSetup({ password: 'correct horse battery' }), (e) => e.code === 'setup_done');
});

test('password change: wrong current, weak and same passwords are refused; the new one works', { skip: SKIP }, async () => {
  const s = await import('../../src/lib/setup.js');
  await assert.rejects(() => s.changePassword('wrong', 'another long password'), (e) => e.code === 'invalid_password');
  await assert.rejects(() => s.changePassword('correct horse battery', 'short'), (e) => e.code === 'weak_password');
  await assert.rejects(() => s.changePassword('correct horse battery', 'correct horse battery'), (e) => e.code === 'same_password');
  await s.changePassword('correct horse battery', 'another long password');
  assert.equal(s.checkPassword('another long password'), true);
  assert.equal(s.checkPassword('correct horse battery'), false);
});
