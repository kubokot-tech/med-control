import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const LOCK_KEY = 727001;
const FILE_RE = /^\d{3}_.+\.sql$/;

/**
 * Apply pending SQL migrations from `dir` (files named NNN_name.sql, lexicographic order).
 * Tracks applied files in `schema_migrations`; each file runs in its own transaction.
 * Serialized across processes via a Postgres advisory lock.
 * Returns { applied: [...], skipped: [...] }.
 */
export async function runMigrations(pool, dir, log = console) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    locked = true;

    await client.query(
      `create table if not exists schema_migrations (
         filename text primary key,
         applied_at timestamptz not null default now()
       )`
    );

    const files = (await readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
    const done = new Set(
      (await client.query('select filename from schema_migrations')).rows.map((r) => r.filename)
    );

    const applied = [];
    const skipped = [];
    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(filename) values($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        log.error({ err }, `migration failed: ${file}`);
        throw err;
      }
      applied.push(file);
    }

    log.info(`migrations: applied ${applied.length}, skipped ${skipped.length} (${dir})`);
    return { applied, skipped };
  } finally {
    if (locked) {
      try {
        await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
      } catch {
        // connection may already be broken; nothing else to do
      }
    }
    client.release();
  }
}
