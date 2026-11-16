import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { SKIP, USER_ID, MIGRATIONS_DIR, setupDb, seedRegimen } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('migrations'); });
after(async () => { if (db) await db.teardown(); });

test('all migrations apply on an empty database and are idempotent', { skip: SKIP }, async () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f));
  assert.equal(db.migrated.applied.length, files.length);
  const { runMigrations } = await import('../../src/lib/migrate.js');
  const again = await runMigrations(db.pool, MIGRATIONS_DIR, db.quiet);
  assert.equal(again.applied.length, 0);
  assert.equal(again.skipped.length, files.length);
  const t = await db.pool.query(`select table_name from information_schema.tables where table_schema='public' order by 1`);
  const names = t.rows.map((r) => r.table_name);
  for (const n of ['events', 'administrations', 'lab_results', 'ingest_documents', 'alerts', 'notifications', 'appointments', 'infusion_sessions', 'passkeys', 'app_settings', 'schema_migrations']) assert.ok(names.includes(n), n);
});

test('019: one dose row per medication and day, events carry meta', { skip: SKIP }, async () => {
  const { medicationId } = await seedRegimen(db.pool);
  await db.pool.query(`insert into administrations (user_id, medication_id, taken_at, day, status) values ($1, $2, '2026-03-01T09:00:00+03:00', '2026-03-01', 'TAKEN')`, [USER_ID, medicationId]);
  await assert.rejects(
    db.pool.query(`insert into administrations (user_id, medication_id, taken_at, day, status) values ($1, $2, '2026-03-01T10:00:00+03:00', '2026-03-01', 'TAKEN')`, [USER_ID, medicationId]),
    /duplicate key/
  );
  await assert.rejects(db.pool.query(`insert into milestones (user_id, date, title, kind) values ($1, '2026-03-01', 'x', 'bogus')`, [USER_ID]), /check constraint|violates/);
  const cols = await db.pool.query(`select column_name from information_schema.columns where table_name='events' and column_name='meta'`);
  assert.equal(cols.rows.length, 1);
});
