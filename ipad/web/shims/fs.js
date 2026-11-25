// node:fs over an in-memory tree. Preloaded with the files the gateway reads from the repository (migrations,
// dictionaries, package.json: virtual:app-files from build.mjs). Data files under /data persist in IndexedDB
// (hydrate below) and a copy goes to the app container through Tauri (container.js), which survives a storage wipe.
import { Buffer } from 'buffer';
import { Readable, Writable } from 'stream';
import { inherits } from 'util';
import APP_FILES from 'virtual:app-files';
import { queueFile, containerFiles, containerOn } from '../container.js';
import { inclusiveSlice } from './range.js';

const files = new Map();   // path -> Buffer
const dirs = new Set(['/']);
const norm = (p) => {
  p = String(p instanceof URL ? decodeURIComponent(p.pathname) : p);
  const parts = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') parts.pop(); else parts.push(s); }
  return `/${parts.join('/')}`;
};
const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const mkdirp = (p) => { for (let d = norm(p); !dirs.has(d); d = parent(d)) dirs.add(d); };
for (const [p, text] of Object.entries(APP_FILES)) {
  files.set(norm(p), text.startsWith('base64:') ? Buffer.from(text.slice(7), 'base64') : Buffer.from(text, 'utf8'));
  mkdirp(parent(norm(p)));
}

// Files under /data (the gateway's DTC_DATA_DIR: jwt.secret, uploaded reports, attachments) are kept in IndexedDB:
// every write goes there in the background, hydrate() loads them back before the gateway starts.
const PERSIST = '/data/';
// Scratch files (the archive import writes its ZIP here) must not multiply into IndexedDB and the container:
// a 2 GB archive would become several copies in memory and disk for nothing.
const keeps = (p) => p.startsWith(PERSIST) && !p.startsWith('/data/tmp/');
let idb;
const modified = new Map();
const store = (mode) => idb.transaction('files', mode).objectStore('files');
const warnMirror = (error) => console.warn('[medcontrol] file copy failed', error);

function mirror(path, bytes, version) {
  return queueFile(path, bytes).then((written) => {
    if (!written) return;
    const pending = idb.transaction('pending', 'readwrite').objectStore('pending');
    const current = pending.get(path);
    current.onsuccess = () => { if (current.result === version) pending.delete(path); };
  });
}

function persist(path, bytes) {
  if (!keeps(path)) return;
  const now = Date.now();
  if (bytes) modified.set(path, now);
  else modified.delete(path);
  if (!idb) return;
  const tx = idb.transaction(['files', 'pending'], 'readwrite');
  const saved = tx.objectStore('files');
  if (bytes) saved.put({ bytes, mtimeMs: now }, path);
  else saved.delete(path);
  if (containerOn()) {
    const version = globalThis.crypto.randomUUID();
    tx.objectStore('pending').put(version, path);
    tx.oncomplete = () => mirror(path, bytes, version).catch(warnMirror);
  }
}
const forget = (p) => persist(p, null);

export async function hydrate() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open('medcontrol-files', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files');
      r.result.createObjectStore('pending');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const pending = new Map();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(['files', 'pending']);
    const c = tx.objectStore('files').openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return;
      const { bytes, mtimeMs } = cur.value;
      files.set(cur.key, Buffer.from(bytes ?? cur.value));
      if (Number.isFinite(mtimeMs)) modified.set(cur.key, mtimeMs);
      mkdirp(parent(cur.key));
      cur.continue();
    };
    const changes = tx.objectStore('pending').openCursor();
    changes.onsuccess = () => {
      const cur = changes.result;
      if (cur) { pending.set(cur.key, cur.value); cur.continue(); }
    };
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });

  const present = new Set();
  for await (const entry of containerFiles()) {
    const p = entry.path;
    present.add(p);
    if (pending.has(p) || modified.has(p)) continue;
    // New records already carry their timestamp. Migrate legacy raw bytes only once.
    const info = await entry.stat();
    const mtimeMs = info.mtime?.getTime() ?? Date.now();
    if (!files.has(p)) {
      files.set(p, Buffer.from(await entry.read()));
      mkdirp(parent(p));
    }
    modified.set(p, mtimeMs);
    store('readwrite').put({ bytes: files.get(p), mtimeMs }, p);
  }
  for (const [p, buf] of files) {
    if (!keeps(p)) continue;
    if (!modified.has(p)) {
      const mtimeMs = Date.now();
      modified.set(p, mtimeMs);
      store('readwrite').put({ bytes: buf, mtimeMs }, p);
    }
    if (!present.has(p) && !pending.has(p) && containerOn()) await queueFile(p, buf);
  }
  for (const [p, version] of pending) await mirror(p, files.get(p) || null, version);
  return modified.size;
}

const err = (code, p, syscall = 'open') => Object.assign(new Error(`${code}: ${syscall} '${p}'`), { code, path: p, syscall, errno: -2 });
const enc = (o) => (typeof o === 'string' ? o : o?.encoding);
const stat = (p, now = new Date(modified.get(p) ?? Date.now())) => {
  const f = files.get(p);
  if (!f && !dirs.has(p)) throw err('ENOENT', p, 'stat');
  return { size: f ? f.length : 0, isFile: () => !!f, isDirectory: () => !f, isSymbolicLink: () => false, mtime: now, mtimeMs: +now, ctime: now, birthtime: now, mode: f ? 0o100600 : 0o40700 };
};
const dirent = (name, dir, isFile) => ({ name, parentPath: dir, path: dir, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false });
function list(p, o = {}) {
  p = norm(p);
  if (!dirs.has(p)) throw err('ENOENT', p, 'scandir');
  const prefix = p === '/' ? '/' : `${p}/`;
  const out = [];
  const seen = new Set();
  for (const all of [[...dirs].map((d) => [d, false]), [...files.keys()].map((f) => [f, true])]) {
    for (const [full, isFile] of all) {
      if (!full.startsWith(prefix) || full === p) continue;
      const rest = full.slice(prefix.length);
      if (!o.recursive && rest.includes('/')) continue;
      if (seen.has(rest)) continue;
      seen.add(rest);
      const dir = parent(full);
      out.push(o.withFileTypes ? dirent(o.recursive ? full.slice(dir.length + 1) : rest, dir, isFile) : rest);
    }
  }
  return out.sort((a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b)));
}

export function existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); }
export function readFileSync(p, o) {
  if (typeof p === 'number') throw err('ENOENT', 'fd');
  p = norm(p);
  const f = files.get(p);
  if (!f) throw err(dirs.has(p) ? 'EISDIR' : 'ENOENT', p);
  const e = enc(o);
  return e ? f.toString(e) : Buffer.from(f);
}
export function writeFileSync(p, data, o) {
  p = norm(p);
  if (!dirs.has(parent(p))) throw err('ENOENT', p);
  const buf = Buffer.isBuffer(data) ? Buffer.from(data) : typeof data === 'string' ? Buffer.from(data, enc(o) || 'utf8') : Buffer.from(data);
  files.set(p, buf);
  persist(p, buf);
}
export function appendFileSync(p, data, o) { const n = norm(p); writeFileSync(n, Buffer.concat([files.get(n) || Buffer.alloc(0), Buffer.from(data, enc(o) || 'utf8')])); }
export function mkdirSync(p, o) { p = norm(p); if (!o?.recursive && !dirs.has(parent(p))) throw err('ENOENT', p, 'mkdir'); mkdirp(p); }
export function statSync(p, o) { try { return stat(norm(p)); } catch (e) { if (o?.throwIfNoEntry === false) return undefined; throw e; } }
export const lstatSync = statSync;
export function readdirSync(p, o) { return list(p, o); }
export function unlinkSync(p) { p = norm(p); if (!files.delete(p)) throw err('ENOENT', p, 'unlink'); forget(p); }
export function rmSync(p, o) {
  p = norm(p);
  if (files.delete(p)) { forget(p); return; }
  if (!dirs.has(p)) { if (o?.force) return; throw err('ENOENT', p, 'rm'); }
  for (const f of [...files.keys()]) if (f.startsWith(`${p}/`)) { files.delete(f); forget(f); }
  for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
}
export function renameSync(a, b) { a = norm(a); b = norm(b); const f = files.get(a); if (!f) throw err('ENOENT', a, 'rename'); files.set(b, f); files.delete(a); forget(a); persist(b, f); }
export function copyFileSync(a, b) { writeFileSync(b, readFileSync(a)); }
export function chmodSync() {}
export function accessSync(p) { if (!existsSync(p)) throw err('ENOENT', norm(p), 'access'); }
export function realpathSync(p) { return norm(p); }
realpathSync.native = realpathSync;
// Function-style streams: graceful-fs (archiver) subclasses them with fs$ReadStream.apply(this, arguments).
export function ReadStream(p, options) {
  if (!(this instanceof ReadStream)) return new ReadStream(p, options);
  Readable.call(this, options);
  const o = options && typeof options === 'object' ? options : {};
  this.path = p; this.flags = 'r'; this.mode = 0o666; this.autoClose = true; this.fd = null; this._sent = false;
  // Node's end is inclusive. unzipper passes { start, end } and the archive import depends on that slice.
  this.start = Number.isFinite(o.start) ? o.start : 0;
  this.end = Number.isFinite(o.end) ? o.end : undefined;
}
inherits(ReadStream, Readable);
ReadStream.prototype.open = function () { this.fd = 3; this.emit('open', 3); this.emit('ready'); };
ReadStream.prototype._read = function () {
  if (this._sent) return;
  this._sent = true;
  try {
    // A view of the stored buffer, not a copy: unzipper reads a large archive in many small ranges,
    // and readFileSync would copy the whole file on every one of them.
    const p = norm(this.path);
    const f = files.get(p);
    if (!f) throw err(dirs.has(p) ? 'EISDIR' : 'ENOENT', p);
    this.push(inclusiveSlice(f, this.start, this.end));
    this.push(null);
  } catch (e) { this.destroy(e); }
};
export function WriteStream(p, options) {
  if (!(this instanceof WriteStream)) return new WriteStream(p, options);
  Writable.call(this, options);
  this.path = p; this.flags = 'w'; this.mode = 0o666; this.fd = null; this._chunks = [];
}
inherits(WriteStream, Writable);
WriteStream.prototype.open = function () { this.fd = 4; this.emit('open', 4); this.emit('ready'); };
WriteStream.prototype._write = function (c, e, cb) { this._chunks.push(Buffer.from(c, e)); cb(); };
WriteStream.prototype._final = function (cb) { try { writeFileSync(this.path, Buffer.concat(this._chunks)); cb(); } catch (e) { cb(e); } };
export function createReadStream(p, o) { return new ReadStream(p, o); }
export function createWriteStream(p, o) { return new WriteStream(p, o); }
export function open(p, flags, mode, cb) { cb = [flags, mode, cb].find((x) => typeof x === 'function'); const n = norm(p); queueMicrotask(() => (files.has(n) || String(flags).includes('w') ? cb(null, 3) : cb(err('ENOENT', n)))); }
export function close(fd, cb) { if (cb) queueMicrotask(() => cb(null)); }
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0 };

const asy = (fn) => async (...a) => fn(...a);
export const promises = {
  readFile: asy(readFileSync), writeFile: asy(writeFileSync), appendFile: asy(appendFileSync), mkdir: asy(mkdirSync),
  stat: asy(statSync), lstat: asy(statSync), readdir: asy(readdirSync), unlink: asy(unlinkSync), rm: asy(rmSync),
  rename: asy(renameSync), copyFile: asy(copyFileSync), chmod: asy(chmodSync), access: asy(accessSync), realpath: asy(realpathSync),
  rmdir: asy((p) => rmSync(p, { recursive: true })),
};
const cbify = (fn) => (...a) => { const cb = a.pop(); try { const r = fn(...a); queueMicrotask(() => cb(null, r)); } catch (e) { queueMicrotask(() => cb(e)); } };
export const readFile = cbify(readFileSync);
export const writeFile = cbify(writeFileSync);
export const stat_ = cbify(statSync);
export { stat_ as stat };
export const readdir = cbify(readdirSync);
export const mkdir = cbify(mkdirSync);
export const unlink = cbify(unlinkSync);
export const access = cbify(accessSync);
export const realpath = cbify(realpathSync);
export const lstat = stat_;
/** Test hook: the whole tree (for the spike page). */
export const __tree = () => ({ dirs: [...dirs], files: [...files.keys()] });
export default {
  existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, lstatSync, readdirSync, unlinkSync, rmSync,
  renameSync, copyFileSync, chmodSync, accessSync, realpathSync, createReadStream, createWriteStream, ReadStream, WriteStream, open, close, constants, promises,
  readFile, writeFile, stat: stat_, lstat, readdir, mkdir, unlink, access, realpath,
};
