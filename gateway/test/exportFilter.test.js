import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubTable } from '../src/lib/exportFilter.js';
import { SECRET_SETTING_KEYS, isSecretSetting } from '../src/lib/config.js';

test('every secret setting is kept out of the export, the GigaChat key included', () => {
  assert.ok(SECRET_SETTING_KEYS.has('cfg_gigachat_auth_key'));
  for (const key of SECRET_SETTING_KEYS) assert.ok(isSecretSetting(key), key);
  for (const key of ['auth_password_hash', 'integration_token_hash', 'token_version', 'cfg_new_service_api_key', 'some_auth_key']) assert.ok(isSecretSetting(key), key);
  for (const key of ['anamnesis', 'llm_provider', 'llm_model', 'mcp_enabled', 'auth_login']) assert.equal(isSecretSetting(key), false, key);
});

test('app_settings rows: secrets dropped, the rest kept', () => {
  const rows = [
    { key: 'llm_provider', value: 'gigachat' },
    { key: 'cfg_gigachat_auth_key', value: 'x' },
    { key: 'cfg_telegram_bot_token', value: 'x' },
    { key: 'auth_password_hash', value: 'x' },
    { key: 'anamnesis', value: 'text' },
  ];
  assert.deepEqual(scrubTable('app_settings', rows).map((r) => r.key), ['llm_provider', 'anamnesis']);
});

test('hash columns are dropped from other tables, other columns stay', () => {
  const rows = [{ id: 1, name: 'Claude', token_hash: 'abc', scope: 'read' }];
  assert.deepEqual(scrubTable('mcp_tokens', rows), [{ id: 1, name: 'Claude', scope: 'read' }]);
  const plain = [{ id: 1, sha256: 'f00' }];
  assert.equal(scrubTable('attachments', plain), plain);
});
