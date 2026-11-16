/**
 * Defaults of the desktop edition (docs/DESKTOP.md, step 2). Imported first by src/server.js and src/migrate.js,
 * before any module reads the environment. With DTC_EDITION=desktop, variables the launcher did not set get:
 *   DB_DRIVER=pglite, PDF_ENGINE=js, GATEWAY_HOST=127.0.0.1, DTC_DATA_DIR=<the app folder of this OS>;
 * the folder is created. Anything set explicitly wins. The server edition is left untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { edition } from './edition.js';

export const APP_DIR_NAME = 'MedControl';

/** The per-user application data folder: macOS Application Support, Windows %APPDATA%, elsewhere XDG data home. */
export function defaultDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', APP_DIR_NAME);
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), APP_DIR_NAME.toLowerCase());
}

/** Fills the desktop defaults into `env` (process.env by default); returns the names it set. */
export function applyDesktopDefaults(env = process.env, platform = process.platform) {
  if (String(env.DTC_EDITION || '').trim().toLowerCase() !== 'desktop') return [];
  const defaults = {
    DB_DRIVER: 'pglite',
    PDF_ENGINE: 'js',
    GATEWAY_HOST: '127.0.0.1',
    DTC_DATA_DIR: defaultDataDir(platform, env),
  };
  const set = [];
  for (const [k, v] of Object.entries(defaults)) {
    if (!env[k]) { env[k] = v; set.push(k); }
  }
  return set;
}

if (edition() === 'desktop') {
  applyDesktopDefaults();
  fs.mkdirSync(process.env.DTC_DATA_DIR, { recursive: true, mode: 0o700 });
}
