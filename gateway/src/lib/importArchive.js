/**
 * Loading a «Скачать все данные» archive back (routes/export.js writes it): moving between installations (server ↔
 * desktop, a new machine) and restoring from one's own copy. Only into an installation without patient data yet,
 * so nothing is merged or overwritten. Secrets and sign-in were never in the archive and are not touched: the login,
 * password, AI keys, Telegram and MCP stay as set on this installation.
 */
import path from 'node:path';
import unzipper from 'unzipper';
import { pool, transaction } from './db.js';
import * as fileStore from './files.js';
import { loadSettings } from './settings.js';
import { invalid, conflict } from './errors.js';
import { safeMime } from './attachmentsStore.js';

// never loaded: the schema itself, the catalog (seeded from code), sign-in and agent access of the old installation
const DENY = new Set(['schema_migrations', 'lab_catalog', 'users', 'app_settings', 'passkeys', 'mcp_tokens', 'mcp_audit']);
// settings that are patient data, not configuration of the old installation
const SETTINGS_ALLOW = ['anamnesis', 'anamnesis_brief', 'treatment_protocol', 'patient_name', 'patient_birth', 'patient_diagnosis'];
// any of these with rows means the installation is in use
const IN_USE = ['events', 'lab_results', 'medications', 'notes', 'milestones', 'symptom_entries', 'appointments', 'contacts'];
const TABLE_RX = /^tables\/([a-z0-9_]+)\.json$/;
const FILE_RX = /^files\/((?:[a-z]+\/)*)([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const CHUNK = 1000;

/** Is there any patient data yet? (the wizard alone leaves none) */
export async function installationInUse(userId) {
  for (const t of IN_USE) {
    const r = await pool.query(`select exists(select 1 from "${t}" where user_id = $1) as e`, [userId]).catch(() => ({ rows: [{ e: false }] }));
    if (r.rows[0].e) return true;
  }
  return false;
}

/**
 * Tables of this database: columns that can be written (not generated), foreign-key parents, single-column foreign
 * keys (child column → parent table) and unique keys (to find the row an archive row collided with).
 */
async function schema(client) {
  const cols = await client.query(`select table_name, column_name from information_schema.columns
                                   where table_schema = 'public' and is_generated = 'NEVER' and coalesce(identity_generation, '') <> 'ALWAYS'`);
  const fks = await client.query(`select cl.relname as child, pr.relname as parent from pg_constraint c
                                  join pg_class cl on cl.oid = c.conrelid join pg_class pr on pr.oid = c.confrelid
                                  join pg_namespace n on n.oid = cl.relnamespace where c.contype = 'f' and n.nspname = 'public'`);
  const columns = new Map();
  for (const r of cols.rows) { if (!columns.has(r.table_name)) columns.set(r.table_name, new Set()); columns.get(r.table_name).add(r.column_name); }
  const parents = new Map();
  for (const r of fks.rows) if (r.child !== r.parent) { if (!parents.has(r.child)) parents.set(r.child, new Set()); parents.get(r.child).add(r.parent); }
  const refs = await client.query(`select cl.relname as child, a.attname as col, pr.relname as parent from pg_constraint c
                                   join pg_class cl on cl.oid = c.conrelid join pg_class pr on pr.oid = c.confrelid
                                   join pg_namespace n on n.oid = cl.relnamespace
                                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                                   where c.contype = 'f' and n.nspname = 'public' and array_length(c.conkey, 1) = 1`);
  const fkCols = new Map(); // child table → [{ col, parent }]
  for (const r of refs.rows) { if (!fkCols.has(r.child)) fkCols.set(r.child, []); fkCols.get(r.child).push({ col: r.col, parent: r.parent }); }
  const uq = await client.query(`select t.relname as tbl, i.indexrelid::text as idx, a.attname as col, k.ord
                                 from pg_index i join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace
                                 cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
                                 join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
                                 where n.nspname = 'public' and i.indisunique and not i.indisprimary and i.indpred is null and i.indexprs is null
                                 order by t.relname, i.indexrelid, k.ord`);
  const uniques = new Map(); // table → [[col, …], …]
  const byIdx = new Map();
  for (const r of uq.rows) { if (!byIdx.has(r.idx)) byIdx.set(r.idx, { tbl: r.tbl, cols: [] }); byIdx.get(r.idx).cols.push(r.col); }
  for (const { tbl, cols } of byIdx.values()) { if (!uniques.has(tbl)) uniques.set(tbl, []); uniques.get(tbl).push(cols); }
  return { columns, parents, fkCols, uniques };
}

/** Parents before children (only among the tables being loaded). */
function loadOrder(tables, parents) {
  const want = new Set(tables); const done = new Set(); const out = [];
  const visit = (t, stack = new Set()) => {
    if (done.has(t)) return;
    if (stack.has(t)) throw conflict('import_bad_archive', 'foreign keys form a cycle');
    stack.add(t);
    for (const p of parents.get(t) || []) if (want.has(p)) visit(p, stack);
    stack.delete(t); done.add(t); out.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return out;
}

/**
 * The old absolute path of a stored file → the same file under this installation's data folder, or null when it is not
 * a path inside the old installation's uploads (a doctored archive could point at /proc/self/environ or the session
 * secret, which GET /attachments would then serve). Windows paths (desktop app) use backslashes.
 */
function newFileRef(oldRef) {
  const m = /\/uploads\/(.+)$/.exec(String(oldRef || '').replace(/\\/g, '/'));
  if (!m) return null;
  const f = FILE_RX.exec(`files/${m[1]}`);
  if (!f) return null;
  return fileStore.refOf(path.posix.join('uploads', f[1]).replace(/\/$/, ''), f[2]);
}

/**
 * Load the archive at `zipPath`. Returns { tables: { name: rows }, files }. Throws CoreError: import_not_empty (409)
 * when the installation already has patient data, import_bad_archive (400) when it is not our export.
 */
export async function importArchive(userId, zipPath, { log = console } = {}) {
  let dir;
  try { dir = await unzipper.Open.file(zipPath); } catch { throw invalid('import_bad_archive'); }
  const entries = new Map(dir.files.map((f) => [f.path, f]));
  if (!entries.has('manifest.json') || !entries.has('tables/events.json')) throw invalid('import_bad_archive');
  if (await installationInUse(userId)) throw conflict('import_not_empty');
  const readJson = async (p) => JSON.parse((await entries.get(p).buffer()).toString('utf8'));

  // files first: if the disk fills up, nothing is in the database yet and the load can be repeated (a file without rows
  // is harmless, names are content hashes); names are checked against path tricks
  let files = 0;
  for (const f of dir.files) {
    if (f.type !== 'File' || !f.path.startsWith('files/')) continue;
    const m = FILE_RX.exec(f.path);
    if (!m || m[1].startsWith('pending/')) { if (!m) log.warn?.({ file: f.path }, 'import: skipped file name'); continue; }
    await fileStore.put(path.posix.join('uploads', m[1]).replace(/\/$/, ''), m[2], await f.buffer());
    files += 1;
  }

  const counts = {};
  await transaction(async (client) => {
    const { columns, parents, fkCols, uniques } = await schema(client);
    // archive id → id of the row already here, per table: a catalog row the new installation made on its own (the
    // infusion catalog after opening «Капельницы», a lab test code) collides by a unique key; children then point at it
    const idMap = new Map();
    const tables = [...entries.keys()].map((p) => TABLE_RX.exec(p)?.[1]).filter((t) => t && !DENY.has(t) && columns.has(t));
    for (const t of loadOrder(tables, parents)) {
      let rows = await readJson(`tables/${t}.json`);
      if (!Array.isArray(rows) || !rows.length) continue;
      const tcols = columns.get(t);
      const refs = (fkCols.get(t) || []).filter((r) => idMap.has(r.parent));
      rows = rows.map((r) => {
        const x = { ...r };
        if ('user_id' in x) x.user_id = userId; // one user per installation; the id may differ between them
        for (const { col, parent } of refs) { const to = idMap.get(parent).get(String(x[col])); if (to !== undefined) x[col] = to; }
        if (t === 'attachments') {
          x.file_url = x.file_url ? newFileRef(x.file_url) : null;
          if (!x.file_url) { log.warn?.({ sha256: x.sha256 }, 'import: attachment without a valid file path skipped'); return null; }
          // the type is the archive's word, not ours: only the upload types stay, the rest is served as a download
          x.mime_type = safeMime(x.mime_type);
        }
        return x;
      }).filter(Boolean);
      if (!rows.length) continue;
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => tcols.has(c));
      const list = cols.map((c) => `"${c}"`).join(', ');
      const withId = tcols.has('id') && cols.includes('id');
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const r = await client.query(`insert into "${t}" (${list}) select ${list} from json_populate_recordset(null::"${t}", $1::json) on conflict do nothing${withId ? ' returning id' : ''}`, [JSON.stringify(chunk)]);
        inserted += withId ? r.rows.length : r.rowCount ?? chunk.length;
        if (!withId || r.rows.length === chunk.length) continue;
        // rows that collided: find the row already here by a unique key and remember its id for the children
        const got = new Set(r.rows.map((x) => String(x.id)));
        for (const row of chunk.filter((x) => !got.has(String(x.id)))) {
          for (const keyCols of uniques.get(t) || []) {
            if (!keyCols.every((c) => cols.includes(c))) continue;
            const where = keyCols.map((c) => `t."${c}" is not distinct from r."${c}"`).join(' and ');
            const hit = await client.query(`select t.id from "${t}" t, json_populate_record(null::"${t}", $1::json) r where ${where} limit 1`, [JSON.stringify(row)]);
            if (hit.rows[0] && String(hit.rows[0].id) !== String(row.id)) {
              if (!idMap.has(t)) idMap.set(t, new Map());
              idMap.get(t).set(String(row.id), hit.rows[0].id);
              break;
            }
          }
        }
      }
      counts[t] = inserted;
      // serial ids continue after the loaded ones (an error here would abort the transaction: check first)
      if (tcols.has('id')) {
        const seq = (await client.query(`select pg_get_serial_sequence('"${t}"', 'id') as s`)).rows[0].s;
        if (seq) await client.query(`select setval($1, coalesce((select max(id) from "${t}"), 1))`, [seq]);
      }
    }
    // the user's own preferences and the patient-data settings
    if (entries.has('tables/users.json')) {
      const u = (await readJson('tables/users.json'))[0];
      if (u) await client.query('update users set timezone = coalesce($2, timezone), locale = coalesce($3, locale), prefs = coalesce($4, prefs), sex = coalesce($5, sex) where id = $1', [userId, u.timezone ?? null, u.locale ?? null, u.prefs ? JSON.stringify(u.prefs) : null, u.sex ?? null]);
    }
    if (entries.has('tables/app_settings.json')) {
      for (const s of await readJson('tables/app_settings.json')) {
        if (!SETTINGS_ALLOW.includes(s.key)) continue;
        await client.query('insert into app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [s.key, s.value]);
      }
    }
  });

  await loadSettings();
  return { tables: counts, files };
}
