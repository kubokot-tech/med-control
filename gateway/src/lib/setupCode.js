/**
 * One-time code for the first-run wizard. Until a password exists anyone who can open the site may finish the wizard
 * and take the installation; when the site is reachable from other machines (APP_URL or BIND_ADDR not loopback) the
 * wizard asks for this code, which only the person with access to the server sees: in the gateway log and in
 * <DATA_DIR>/setup-code.txt. A local install opened on the same machine, and the desktop app, need no code.
 */
import { randomInt, timingSafeEqual } from 'node:crypto';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { edition } from './edition.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let current = null;

const loopback = (host) => /^(localhost|127(\.\d+){3}|::1|\[::1\])$/i.test(String(host || '').trim());
const file = () => path.join(process.env.DTC_DATA_DIR || '/data', 'setup-code.txt');
const normalize = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** A client address outside this machine and the home network (a tunnel, a published port): the internet. */
export function publicAddress(ip) {
  const a = String(ip || '').replace(/^::ffff:/i, '').toLowerCase();
  if (!a) return false;
  if (a.includes(':')) return !(a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a));
  const [x, y] = a.split('.').map(Number);
  if (x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254)) return false;
  if (x === 100 && y >= 64 && y <= 127) return false; // carrier-grade NAT range: Tailscale addresses
  return true;
}

/** Can a code be asked at all (DTC_SETUP_CODE=off, the desktop app listening on 127.0.0.1 only: never). */
const codeAllowed = () => String(process.env.DTC_SETUP_CODE || '').toLowerCase() !== 'off' && edition() !== 'desktop';

/**
 * Does the wizard need the code: always when the site is set up to be reachable from other machines (APP_URL or
 * BIND_ADDR not loopback, or DTC_SETUP_CODE=on), and for a request from a public address whatever the settings say
 * (a tunnel to an install still at its defaults).
 */
export function setupCodeRequired(ip = null) {
  if (!codeAllowed()) return false;
  if (String(process.env.DTC_SETUP_CODE || '').toLowerCase() === 'on') return true;
  let appHost = 'localhost';
  try { appHost = new URL(process.env.APP_URL || 'http://localhost:3001').hostname; } catch { /* default */ }
  if (!(loopback(appHost) && loopback(process.env.DTC_BIND_ADDR || '127.0.0.1'))) return true;
  return publicAddress(ip);
}

/**
 * At start (`needed`: the wizard is pending): a fresh code, written to the log and the data folder. Made even when the
 * settings do not ask for it: a request from a public address will (setupCodeRequired with the client address).
 */
export function prepareSetupCode(needed, log = console) {
  current = null;
  if (!needed || !codeAllowed()) { clearSetupCode(); return null; }
  let raw = '';
  for (let i = 0; i < 8; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
  current = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  try {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), `${current}\n`, { mode: 0o600 });
  } catch (e) { log.warn?.({ err: e.message }, 'setup code: could not write the file'); }
  // SETUP_CODE is the stable ASCII marker the English docs grep for; the Russian ones grep for the words before it
  log.warn?.({ setupCode: current }, `Код первого запуска: ${current} (мастер спросит его, если сайт открыт не только на этом компьютере) SETUP_CODE=${current}`);
  return current;
}

export function checkSetupCode(input) {
  if (!current) return false;
  const a = Buffer.from(normalize(input)); const b = Buffer.from(normalize(current));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clearSetupCode() {
  current = null;
  try { rmSync(file(), { force: true }); } catch { /* nothing to remove */ }
}
