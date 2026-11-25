import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * A `pg.Pool` look-alike over PGlite (Postgres in WebAssembly) for the desktop build (`DB_DRIVER=pglite`).
 *
 * PGlite has a single connection, so the facade serialises access with a FIFO lock:
 * - `query(sql, params)` waits for the lock, runs one statement, releases;
 * - `connect()` holds the lock until the client's `release()` (migrations use it with BEGIN/COMMIT);
 * - `transaction(fn)` holds the lock for BEGIN … COMMIT. Code called from `fn` that uses `pool.query` (instead of the
 *   transaction client) runs inside the transaction instead of waiting for the lock it holds, which would deadlock.
 *   A nested `transaction` becomes a savepoint.
 *
 * Results follow node-pg: `{ rows, rowCount, fields, command }`, DATE as 'YYYY-MM-DD', BIGINT and NUMERIC as strings.
 * The session time zone is UTC, as on the server's Postgres container; local days are computed with explicit zones.
 */

const DATE = 1082;
const INT8 = 20;

function makeLock() {
  let tail = Promise.resolve();
  return function acquire() {
    let release;
    const held = new Promise((r) => { release = r; });
    const ready = tail.then(() => release);
    tail = tail.then(() => held);
    return ready;
  };
}

/** node-pg uses the simple protocol when there are no parameters: several statements in one string are allowed. */
async function run(db, sql, params) {
  if (params && params.length) return shape(await db.query(sql, params));
  const results = await db.exec(sql);
  return shape(results[results.length - 1] || { rows: [], fields: [] });
}

function shape(r) {
  const rows = r.rows || [];
  // PGlite reports affectedRows for INSERT/UPDATE/DELETE and 0 for SELECT; node-pg's rowCount is the row count there.
  return { rows, rowCount: r.affectedRows || rows.length, fields: r.fields || [], command: r.command };
}

export async function createPglitePool({ dataDir, loadDataDir } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const opts = {
    dataDir,
    extensions: { pgcrypto },
    parsers: { [DATE]: (v) => v, [INT8]: (v) => v },
  };
  // Validate recovery candidates in memory first. Opening a damaged archive in the live
  // IndexedDB can leave an empty database that prevents recovery on the next launch.
  const recovery = loadDataDir ? null : await globalThis.__MC_RECOVER_DB?.(async (blob) => {
    const probe = await PGlite.create({ ...opts, dataDir: 'memory://', loadDataDir: blob });
    try { await probe.query('select 1 from users limit 1'); } finally { await probe.close(); }
  });
  const load = loadDataDir ?? recovery?.blob;
  if (load) opts.loadDataDir = load;
  let db;
  try {
    if (load && load.size < 10) throw new Error('Truncated database snapshot');
    db = await PGlite.create(opts);
  } catch (e) {
    if (!load) throw e;
    if (!loadDataDir) {
      globalThis.__MC_RESTORE_FAILED = true;
      throw e;
    }
    // The browser edition must not overwrite the stored copy with what may be an empty database:
    // the iPad page reads this flag and holds its snapshots until the owner resolves the situation.
    globalThis.__MC_RESTORE_FAILED = true;
    console.warn('[medcontrol] stored database could not be opened, starting from the browser copy', e);
    delete opts.loadDataDir;
    db = await PGlite.create(opts);
  }
  await db.exec(`set time zone 'UTC'`);
  recovery?.opened();

  const acquire = makeLock();
  // The transaction that owns the lock in this async context; `open` turns false at COMMIT/ROLLBACK, so a stray
  // promise started inside `fn` and finishing later goes back through the lock.
  const owner = new AsyncLocalStorage();
  const inside = () => owner.getStore()?.open === true;
  let closed = false;
  let savepoints = 0;

  const direct = { query: (sql, params) => run(db, sql, params), release() {} };

  async function locked(fn) {
    const release = await acquire();
    try { return await fn(); } finally { release(); }
  }

  async function asOwner(fn) {
    const tx = { open: true };
    try { return await owner.run(tx, fn); } finally { tx.open = false; }
  }

  const pool = {
    driver: 'pglite',
    db,

    async query(sql, params) {
      if (inside()) return run(db, sql, params);
      return locked(() => run(db, sql, params));
    },

    async connect() {
      if (inside()) return direct;
      const release = await acquire();
      let done = false;
      return {
        query: (sql, params) => run(db, sql, params),
        release() { if (!done) { done = true; release(); } },
      };
    },

    /** BEGIN … COMMIT with the lock held; ROLLBACK and rethrow on error. Nested calls use a savepoint. */
    async transaction(fn) {
      if (inside()) {
        const sp = `sp_${++savepoints}`;
        await run(db, `savepoint ${sp}`);
        try {
          const out = await fn(direct);
          await run(db, `release savepoint ${sp}`);
          return out;
        } catch (e) {
          await run(db, `rollback to savepoint ${sp}`).catch(() => {});
          throw e;
        }
      }
      return locked(() => asOwner(async () => {
        await run(db, 'BEGIN');
        try {
          const out = await fn(direct);
          await run(db, 'COMMIT');
          return out;
        } catch (e) {
          await run(db, 'ROLLBACK').catch(() => {});
          throw e;
        }
      }));
    },

    on() { return pool; },

    async end() {
      if (closed) return;
      closed = true;
      await locked(() => db.close());
    },
  };

  return pool;
}
