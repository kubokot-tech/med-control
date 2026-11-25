import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPglitePool } from '../src/lib/pglite.js';

let pool;
before(async () => {
  pool = await createPglitePool({ dataDir: 'memory://' });
  await pool.query('create table t (id serial primary key, v int not null)');
});
after(async () => { await pool.end(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('results look like node-pg: rowCount, DATE as text, BIGINT and NUMERIC as strings, UTC session', async () => {
  const ins = await pool.query('insert into t (v) values ($1), ($2)', [1, 2]);
  assert.equal(ins.rowCount, 2);
  const sel = await pool.query('select (select count(*) from t) c, 1.50::numeric n, $1::date d, current_setting($2) tz', ['2026-03-04', 'TimeZone']);
  assert.equal(sel.rowCount, 1);
  assert.deepEqual(sel.rows[0], { c: '2', n: '1.50', d: '2026-03-04', tz: 'UTC' });
  const del = await pool.query('delete from t where v = $1', [99]);
  assert.equal(del.rowCount, 0);
});

test('several statements without parameters run like the simple protocol and return the last result', async () => {
  const r = await pool.query('select 1 a; select 2 b');
  assert.deepEqual(r.rows, [{ b: 2 }]);
});

test('a query from another handler waits for the open transaction instead of landing in it', async () => {
  let seen;
  const tx = pool.transaction(async (c) => {
    await c.query('insert into t (v) values ($1)', [10]);
    await sleep(30);
    await c.query('insert into t (v) values ($1)', [11]);
    throw new Error('boom');
  });
  await sleep(5);
  const outside = pool.query('select count(*) n from t where v in (10, 11)').then((r) => { seen = r.rows[0].n; });
  await assert.rejects(tx, /boom/);
  await outside;
  assert.equal(seen, '0');
});

test('pool.query inside a transaction runs in it; a nested transaction is a savepoint', async () => {
  const n = await pool.transaction(async (c) => {
    await c.query('insert into t (v) values ($1)', [20]);
    const inner = await pool.query('select count(*) n from t where v = 20');
    await pool.transaction(async (c2) => {
      await c2.query('insert into t (v) values ($1)', [21]);
    });
    await pool.transaction(async (c2) => {
      await c2.query('insert into t (v) values ($1)', [22]);
      throw new Error('inner');
    }).catch(() => {});
    return inner.rows[0].n;
  });
  assert.equal(n, '1');
  const r = await pool.query('select v from t where v in (20, 21, 22) order by v');
  assert.deepEqual(r.rows.map((x) => x.v), [20, 21]);
});

test('connect() holds the connection until release', async () => {
  const client = await pool.connect();
  let done = false;
  const waiting = pool.query('select 1').then(() => { done = true; });
  await client.query('select pg_advisory_lock(1)');
  await sleep(10);
  assert.equal(done, false);
  await client.query('select pg_advisory_unlock(1)');
  client.release();
  await waiting;
  assert.equal(done, true);
});

test('errors carry the SQLSTATE code', async () => {
  await assert.rejects(pool.query('insert into t (v) values ($1)', [null]), (e) => e.code === '23502');
});

test('an unreadable stored copy falls back to the browser database and raises the restore flag', async () => {
  // The iPad page reads this flag and holds its snapshots: overwriting the only copy with an empty
  // database would destroy the history (ipad/web/gateway-entry.js, env.js).
  delete globalThis.__MC_RESTORE_FAILED;
  const broken = new Blob([Uint8Array.of(1, 2, 3, 4)]); // not a tarball
  const p = await createPglitePool({ dataDir: 'memory://', loadDataDir: broken });
  try {
    assert.equal(globalThis.__MC_RESTORE_FAILED, true);
    assert.deepEqual((await p.query('select 1 as one')).rows, [{ one: 1 }]);
  } finally { await p.end(); delete globalThis.__MC_RESTORE_FAILED; }
});

test('without a stored copy nothing raises the flag', async () => {
  delete globalThis.__MC_RESTORE_FAILED;
  const p = await createPglitePool({ dataDir: 'memory://' });
  try {
    assert.equal(globalThis.__MC_RESTORE_FAILED, undefined);
  } finally { await p.end(); }
});

test('iPad startup restores the previous generation after a damaged newest snapshot', async () => {
  const { readDatabaseCopy } = await import('../../ipad/web/container.js');
  const source = await createPglitePool({ dataDir: 'memory://' });
  let previous;
  try {
    await source.query('create table users (id int primary key)');
    await source.query('insert into users values (42)');
    previous = new Uint8Array(await (await source.db.dumpDataDir()).arrayBuffer());
  } finally { await source.end(); }
  const read = async (name) => name.endsWith('.prev') ? previous : new Uint8Array(2048);
  let opened = false;
  globalThis.__MC_RECOVER_DB = async (validate) => {
    const recovered = await readDatabaseCopy(validate, read);
    assert.equal(recovered.generation, 'pgdata.tar.prev');
    return { blob: recovered.blob, opened() { opened = true; } };
  };
  try {
    const restored = await createPglitePool({ dataDir: 'memory://' });
    assert.equal(opened, true);
    try { assert.deepEqual((await restored.query('select id from users')).rows, [{ id: 42 }]); }
    finally { await restored.end(); }
  } finally { delete globalThis.__MC_RECOVER_DB; }
});

test('unreadable iPad snapshots do not start a fresh database', async () => {
  const { readDatabaseCopy } = await import('../../ipad/web/container.js');
  await assert.rejects(readDatabaseCopy(() => {}, async () => new Uint8Array(2048)), /No readable/);
});
