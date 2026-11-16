import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('userlocale'); });
after(async () => { if (db) await db.teardown(); });

const invalidBody = (e) => e.name === 'CoreError' && e.code === 'invalid_body';

test('language and regional settings: defaults, partial changes, refusal of unknown values, formatter', { skip: SKIP }, async () => {
  const { getUserLocale, setUserLocale, userFormat } = await import('../../src/lib/userLocale.js');
  const cur = await getUserLocale(USER_ID);
  assert.equal(cur.language, 'ru');
  assert.deepEqual(cur.prefs, { region: 'RU', dateFormat: 'auto', hourCycle: 'auto', weekStart: 'auto', labUnits: 'auto', temperature: 'auto', weight: 'auto' });

  const us = await setUserLocale(USER_ID, { prefs: { region: 'us' } });
  assert.equal(us.prefs.region, 'US');
  const more = await setUserLocale(USER_ID, { prefs: { hourCycle: 'h23' } });
  assert.deepEqual(more.prefs, { region: 'US', dateFormat: 'auto', hourCycle: 'h23', weekStart: 'auto', labUnits: 'auto', temperature: 'auto', weight: 'auto' });

  await assert.rejects(setUserLocale(USER_ID, { prefs: { region: 'XX' } }), invalidBody);
  await assert.rejects(setUserLocale(USER_ID, { prefs: { dateFormat: 'yyyy' } }), invalidBody);
  await assert.rejects(setUserLocale(USER_ID, { language: 'xx' }), invalidBody);

  const f = await userFormat(USER_ID);
  assert.equal(f.date('2026-11-02'), '11/02/2026');
  assert.equal(f.hourCycle, 'h23');
  assert.equal(f.weekStart, 7);

  // garbage in the column (hand edit) reads as defaults
  await db.pool.query(`update users set prefs = '{"region": 5, "dateFormat": "x"}'::jsonb where id = $1`, [USER_ID]);
  assert.deepEqual((await getUserLocale(USER_ID)).prefs, { region: 'RU', dateFormat: 'auto', hourCycle: 'auto', weekStart: 'auto', labUnits: 'auto', temperature: 'auto', weight: 'auto' });
});

test('settings summary: codes and numbers for every section', { skip: SKIP }, async () => {
  const { settingsSummary } = await import('../../src/lib/settingsSummary.js');
  const s = await settingsSummary(USER_ID);
  assert.deepEqual(Object.keys(s).sort(), ['ai', 'anamnesis', 'backup', 'edition', 'health', 'locale', 'mcp', 'pdf', 'protocol', 'refs', 'security', 'telegram']);
  assert.equal(s.protocol.chosen, false);
  assert.ok(s.protocol.rules > 0);
  assert.equal(s.anamnesis.filled, false);
  assert.deepEqual(s.refs, { sex: null, own: 0 });
  assert.equal(s.ai.state, 'off');
  assert.equal(s.health.state, 'off');
  assert.equal(s.security.passkeys, 0);
  assert.equal(s.backup.state, 'none');
  assert.ok(['ok', 'down'].includes(s.pdf.state));
  assert.ok(['ready', 'partial', 'off'].includes(s.telegram.state));
  // nothing in the answer is a ready-made Russian phrase
  assert.ok(!/[А-Яа-яЁё]/.test(JSON.stringify({ ...s, protocol: { ...s.protocol, name: null } })));
});

test('the time zone can be changed later; a wrong one is refused', { skip: SKIP }, async () => {
  const { setUserLocale, getUserLocale } = await import('../../src/lib/userLocale.js');
  const r = await setUserLocale(USER_ID, { timeZone: 'Asia/Novosibirsk' });
  assert.equal(r.timeZone, 'Asia/Novosibirsk');
  assert.equal((await getUserLocale(USER_ID)).timeZone, 'Asia/Novosibirsk');
  await assert.rejects(setUserLocale(USER_ID, { timeZone: 'Mars/Olympus' }), (e) => e.code === 'bad_timezone');
});
