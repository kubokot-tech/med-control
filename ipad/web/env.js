// Imported first: the environment the gateway modules read at import time (the browser edition's desktopEnv).
import process from 'process';
globalThis.process = process;
Object.assign(process.env, {
  DTC_EDITION: 'ipad',
  DB_DRIVER: 'pglite',
  PDF_ENGINE: 'js',
  DTC_DATA_DIR: '/data',
  PGLITE_DIR: globalThis.__MC_PGLITE_DIR || 'idb://medcontrol',
  MIGRATIONS_DIR: '/app/db/migrations',
  RECANONICALIZE_ON_START: '0',
  NODE_ENV: 'production',
});
process.uptime = process.uptime || (() => performance.now() / 1000);
// The polyfill's nextTick goes through setTimeout (clamped to 4 ms): Fastify's plugin loader makes thousands of them.
process.nextTick = (fn, ...args) => queueMicrotask(() => fn(...args));
process.platform = 'ios';
// no process.versions.node: Emscripten (PGlite) would take the page for Node and read its files with fs
// setImmediate on a MessageChannel: setTimeout(0) is clamped to 4 ms after a few nested calls, which slows streams
// Recognition files shipped in the app. A blob worker cannot importScripts them, so the worker is a same-origin script.
if (typeof location !== 'undefined') {
  const file = (p) => new URL(p, location.href).href;
  globalThis.__MC_OCR = {
    langPath: file('/ocr/').replace(/\/$/, ''),
    workerPath: file('/ocr/worker.min.js'),
    corePath: file('/ocr/tesseract-core-lstm.wasm.js'),
  };
}
// If iPad wiped the browser database and the app folder still has a copy, load that copy before PGlite opens.
globalThis.__MC_BEFORE_DB = (async () => {
  try {
    if (!globalThis.__TAURI_INTERNALS__ || typeof indexedDB === 'undefined') return;
    // databases() arrived in Safari 17.4; the app requires 17.4 for exactly this reason.
    if (!indexedDB.databases) { console.warn('[medcontrol] database restore unavailable: indexedDB.databases() is missing (needs iPadOS 17.4)'); return; }
    const names = (await indexedDB.databases()).map((d) => d.name);
    // PGlite opens IndexedDB as the mount point "/pglite/medcontrol", not the short name.
    if (names.includes('/pglite/medcontrol') || names.includes('medcontrol')) return;
    const { readDatabaseCopy } = await import('./container.js');
    const tar = await readDatabaseCopy();
    if (tar && tar.byteLength > 1024) globalThis.__MC_PGLITE_LOAD = new Blob([tar]);
  } catch (e) {
    // A copy may exist but be unreadable. Starting empty and snapshotting over it would destroy the history:
    // the flag holds all snapshots until the owner resolves the situation (gateway-entry.js, pglite.js).
    globalThis.__MC_RESTORE_FAILED = true;
    console.warn('[medcontrol] database restore skipped', e);
  }
})();
if (!globalThis.setImmediate) {
  const ch = new MessageChannel();
  const queue = new Map();
  let id = 0;
  ch.port1.onmessage = (e) => { const job = queue.get(e.data); if (job) { queue.delete(e.data); job.fn(...job.args); } };
  globalThis.setImmediate = (fn, ...args) => { const n = ++id; queue.set(n, { fn, args }); ch.port2.postMessage(n); return n; };
  globalThis.clearImmediate = (n) => { queue.delete(n); };
}
