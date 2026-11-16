// CLI: node src/migrate.js  (uses DATABASE_URL, optional MIGRATIONS_DIR)
import './lib/desktopEnv.js';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/db.js';
import { runMigrations } from './lib/migrate.js';

const dir =
  process.env.MIGRATIONS_DIR || fileURLToPath(new URL('../../db/migrations', import.meta.url));

try {
  await runMigrations(pool, dir);
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
}
