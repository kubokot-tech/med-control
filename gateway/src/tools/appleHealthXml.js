/**
 * One-off import of Apple Health history: Здоровье → профиль → «Экспортировать все данные» → export.zip → export.xml.
 * Usage (on the server):  docker compose exec -T gateway node src/tools/appleHealthXml.js < /path/to/export.xml
 * Streams the file line by line; safe to re-run (samples are deduplicated by kind and time).
 */
import readline from 'node:readline';
import { pool } from '../lib/db.js';
import { loadSettings } from '../lib/settings.js';
import { loadCatalog } from '../lib/canonical.js';
import { parseHealthXml, importSamples } from '../lib/healthImport.js';
import { HARDCODED_USER_ID } from '../lib/auth.js';

await loadSettings();
await loadCatalog(pool);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const samples = [];
const counts = {};
for await (const s of parseHealthXml(rl)) { samples.push(s); counts[s.kind] = (counts[s.kind] || 0) + 1; }
console.log('parsed:', counts);
// step_count comes as thousands of small intervals: keep them, the diary sums per day
const summary = await importSamples(HARDCODED_USER_ID, samples, { source: 'apple_health_xml' });
console.log('imported:', summary);
await pool.end();
