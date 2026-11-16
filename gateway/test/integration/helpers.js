/**
 * Integration test harness: a fresh database per test file, migrations applied, catalog and settings loaded,
 * the single user inserted.
 * - Postgres (default): a database created from TEST_DATABASE_URL, an admin connection.
 * - PGlite (TEST_DB=pglite): an in-memory PGlite per test file (node --test runs each file in its own process).
 * Skipped entirely when neither is set.
 */
import pg from 'pg';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PGLITE = process.env.TEST_DB === 'pglite';
export const ADMIN_URL = PGLITE ? '' : process.env.TEST_DATABASE_URL || '';
export const SKIP = !PGLITE && !ADMIN_URL;
export const USER_ID = '00000000-0000-0000-0000-000000000001';
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };

export async function setupDb(name) {
  const dbName = `dtc_test_${name}_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  if (PGLITE) {
    process.env.DB_DRIVER = 'pglite';
    process.env.PGLITE_DIR = 'memory://';
  } else {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const url = new URL(ADMIN_URL); url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
  }
  process.env.DTC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dtc-test-'));
  process.env.TELEGRAM_BOT_TOKEN ||= 'test-token';
  process.env.TELEGRAM_CHAT_ID ||= '111';
  process.env.APP_URL ||= 'https://dtc.test';
  // the first-run code has its own test (setupCode.test.js); elsewhere the wizard runs without it
  process.env.DTC_SETUP_CODE ||= 'off';
  // tests stand in for the ingestion service with a fetchImpl stub; pdfEngineJs.test.js switches to the gateway's engine
  process.env.PDF_ENGINE ||= 'python';
  process.env.BACKUP_STATUS_FILE = path.join(process.env.DTC_DATA_DIR, 'no-status.json');
  const { pool } = await import('../../src/lib/db.js');
  const { runMigrations } = await import('../../src/lib/migrate.js');
  const { loadCatalog } = await import('../../src/lib/canonical.js');
  const { loadSettings } = await import('../../src/lib/settings.js');
  const migrated = await runMigrations(pool, MIGRATIONS_DIR, quiet);
  await loadCatalog(pool);
  await loadSettings();
  await pool.query(`insert into users (id, email, password_hash, timezone) values ($1, 'test@dtc', '', 'Europe/Moscow') on conflict (id) do nothing`, [USER_ID]);
  const teardown = async () => {
    await pool.end();
    if (PGLITE) return;
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${dbName} with (force)`);
    await a.end();
  };
  return { pool, migrated, teardown, dbName, quiet };
}

/** Example regimen: lenvatinib 24 mg daily from 2026-01-01 (the lenvatinib preset in lib/protocol.js). */
export async function seedRegimen(pool) {
  const m = await pool.query(`insert into medications (user_id, name, form, strength, unit, role, sort_order) values ($1, 'Ленватиниб', 'capsule', '24', 'mg', 'systemic', 10) returning id`, [USER_ID]);
  const r = await pool.query(`insert into regimens (user_id, name, start_date) values ($1, 'Ленватиниб 24мг ежедневно', '2026-01-01') returning id`, [USER_ID]);
  const ri = await pool.query(`insert into regimen_items (regimen_id, medication_id, dose_value, dose_unit, route, frequency_rule, time_windows, prn) values ($1, $2, 24, 'mg', 'po', 'DAILY', '{}'::jsonb, false) returning id`, [r.rows[0].id, m.rows[0].id]);
  return { medicationId: m.rows[0].id, regimenItemId: ri.rows[0].id };
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
