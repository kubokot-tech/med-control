import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDataDir, applyDesktopDefaults } from '../src/lib/desktopEnv.js';

test('the app folder per OS', () => {
  assert.equal(defaultDataDir('darwin', {}, '/Users/a'), '/Users/a/Library/Application Support/MedControl');
  assert.equal(defaultDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\MedControl');
  assert.equal(defaultDataDir('win32', {}, 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\MedControl');
  assert.equal(defaultDataDir('linux', {}, '/home/a'), '/home/a/.local/share/medcontrol');
  assert.equal(defaultDataDir('linux', { XDG_DATA_HOME: '/x' }, '/home/a'), '/x/medcontrol');
});

test('the server edition gets no defaults', () => {
  const env = { DATABASE_URL: 'postgres://x' };
  assert.deepEqual(applyDesktopDefaults(env, 'linux'), []);
  assert.deepEqual(env, { DATABASE_URL: 'postgres://x' });
});

test('the desktop edition fills what the launcher did not set and keeps the rest', () => {
  const env = { DTC_EDITION: 'desktop', PDF_ENGINE: 'python', DTC_DATA_DIR: '/data/mc' };
  assert.deepEqual(applyDesktopDefaults(env, 'darwin').sort(), ['DB_DRIVER', 'GATEWAY_HOST']);
  assert.deepEqual(env, { DTC_EDITION: 'desktop', PDF_ENGINE: 'python', DTC_DATA_DIR: '/data/mc', DB_DRIVER: 'pglite', GATEWAY_HOST: '127.0.0.1' });
});

test('the ipad edition gets the same defaults as desktop', () => {
  const env = { DTC_EDITION: 'ipad' };
  assert.deepEqual(applyDesktopDefaults(env, 'darwin').sort(), ['DB_DRIVER', 'DTC_DATA_DIR', 'GATEWAY_HOST', 'PDF_ENGINE']);
  assert.equal(env.DB_DRIVER, 'pglite');
});
