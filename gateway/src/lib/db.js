import path from 'node:path';
import pg from 'pg';

const { Pool, types } = pg;

/**
 * Two drivers behind one interface:
 * - `pg` (default): a node-postgres pool on DATABASE_URL — the server build;
 * - `pglite`: Postgres in WebAssembly in this process (`lib/pglite.js`), data in PGLITE_DIR
 *   (default DTC_DATA_DIR/pgdata; `memory://` keeps it in memory) — the desktop build.
 */
export const DRIVER = process.env.DB_DRIVER || 'pg';
if (DRIVER !== 'pg' && DRIVER !== 'pglite') throw new Error(`DB_DRIVER must be pg or pglite, got ${DRIVER}`);

export const pgliteDir = () => process.env.PGLITE_DIR || path.join(process.env.DTC_DATA_DIR || '/data', 'pgdata');

function openPg() {
  // DATE (oid 1082) as the literal 'YYYY-MM-DD' string: node-pg would otherwise build a Date at local
  // midnight, and toISOString() in a +TZ container shifts it to the previous day.
  types.setTypeParser(1082, (v) => v);

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

  const p = new Pool({ connectionString: DATABASE_URL });

  // An idle client can be cut by the server (Postgres restart, failover, a test dropping its database). Without a
  // listener node-postgres re-throws that as an unhandled 'error' event and the whole gateway exits; the pool
  // already discards the broken client, so logging is enough.
  p.on('error', (err) => {
    console.error(JSON.stringify({ level: 50, msg: 'postgres idle client error', err: { message: err.message, code: err.code } }));
  });
  return p;
}

// @electric-sql/pglite is an optional dependency: the server image installs with --omit=optional and never loads it.
async function openPglite() {
  const { createPglitePool } = await import('./pglite.js');
  return createPglitePool({ dataDir: pgliteDir() });
}

export const pool = DRIVER === 'pglite' ? await openPglite() : openPg();

/**
 * Storage interface for the core: `query` for single statements, `transaction(fn)` for several that must land together.
 * Everything above this file uses only these two, so another backend (PGlite in the local app) can implement them
 * with the same SQL. `fn` receives a client with `query`; returning ends with COMMIT, throwing with ROLLBACK.
 */
class Abort extends Error {
  constructor(value) { super('transaction aborted'); this.value = value; }
}
/** Inside `transaction(fn)`: roll back and make `transaction` return `value` (for «not found» exits). */
export function abort(value = null) { throw new Abort(value); }

export async function query(sql, params) {
  return pool.query(sql, params);
}

export async function transaction(fn) {
  if (pool.transaction) {
    try {
      return await pool.transaction(fn);
    } catch (e) {
      if (e instanceof Abort) return e.value;
      throw e;
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e instanceof Abort) return e.value;
    throw e;
  } finally {
    client.release();
  }
}
