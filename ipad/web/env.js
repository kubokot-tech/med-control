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
globalThis.__MC_RECOVER_DB = async (validate) => {
  if (!globalThis.__TAURI_INTERNALS__ || typeof indexedDB === 'undefined') return null;
  const words = (await globalThis.mcWords?.load())?.recovery;
  try {
    const names = (await indexedDB.databases()).map((d) => d.name);
    const liveName = '/pglite/medcontrol';
    const marker = 'mc_db_restore_pending';
    const retry = localStorage.getItem(marker) === liveName;
    if (!retry && (names.includes(liveName) || names.includes('medcontrol'))) return null;
    const { readDatabaseCopy } = await import('./container.js');
    const recovered = await readDatabaseCopy(validate);
    if (!recovered) {
      if (retry) throw new Error('Interrupted restoration has no readable snapshot');
      return null;
    }
    // The marker is set only if no live database existed. A failed attempt can leave
    // an empty IDB name behind. Retry from a validated snapshot before exposing it.
    localStorage.setItem(marker, liveName);
    if (retry && names.includes(liveName)) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(liveName);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Close other views to restore the database'));
      });
    }
    return {
      blob: recovered.blob,
      opened() {
        localStorage.removeItem(marker);
        if (recovered.generation !== 'pgdata.tar') {
          globalThis.alert?.(words?.previous || 'Restored an alternate database snapshot.');
        }
      },
    };
  } catch (err) {
    globalThis.__MC_RESTORE_FAILED = true;
    globalThis.alert?.(words?.failed || 'Unable to restore the database. The saved snapshots have been preserved.');
    throw err;
  }
};
if (!globalThis.setImmediate) {
  const ch = new MessageChannel();
  const queue = new Map();
  let id = 0;
  ch.port1.onmessage = (e) => { const job = queue.get(e.data); if (job) { queue.delete(e.data); job.fn(...job.args); } };
  globalThis.setImmediate = (fn, ...args) => { const n = ++id; queue.set(n, { fn, args }); ch.port2.postMessage(n); return n; };
  globalThis.clearImmediate = (n) => { queue.delete(n); };
}
