// A copy of the iPad data outside WKWebView. IndexedDB can be wiped; the app container is not.
// Paths are relative to the app data directory: medcontrol/files/data/… and medcontrol/pgdata.tar.

const ROOT = 'medcontrol';
const FILES = `${ROOT}/files`;

export const containerOn = () => typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function';

const plugin = () => import('@tauri-apps/plugin-fs');

let chain = Promise.resolve();

export function queueFile(absPath, bytesOrNull) {
  if (!containerOn() || !String(absPath).startsWith('/data/')) return;
  const rel = `${FILES}${absPath}`;
  const copy = bytesOrNull ? Uint8Array.from(bytesOrNull) : null;
  chain = chain.then(() => writeRel(rel, copy)).catch((e) => console.warn('[medcontrol] file copy failed', e));
}

export async function readDatabaseCopy() {
  if (!containerOn()) return null;
  // The newest complete copy wins; the previous generation survives a crash between the two renames.
  // A read error is not «no copy»: it propagates, so the caller can refuse to start (and overwrite) blindly.
  let failed = false;
  for (const name of ['pgdata.tar', 'pgdata.tar.prev']) {
    try {
      const bytes = await readRel(`${ROOT}/${name}`);
      if (bytes && bytes.byteLength > 1024) return bytes;
    } catch { failed = true; }
  }
  if (failed) throw new Error('the database copy is there but could not be read');
  return null;
}

export function writeDatabaseCopy(bytes) {
  if (!containerOn()) return Promise.resolve(false);
  return writeTar(bytes);
}

async function writeTar(bytes) {
  const { writeFile, rename, mkdir, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  const dirs = { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData };
  await mkdir(ROOT, { ...base, recursive: true });
  const tmp = `${ROOT}/pgdata.tar.tmp`;
  const dest = `${ROOT}/pgdata.tar`;
  const prev = `${ROOT}/pgdata.tar.prev`;
  await writeFile(tmp, bytes, base);
  // Each rename is atomic: at any crash moment at least one of dest/prev/tmp is a complete copy.
  // The old copy becomes the previous generation instead of being deleted first.
  await rename(dest, prev, dirs).catch(() => {});
  await rename(tmp, dest, dirs);
  return true;
}

async function writeRel(rel, bytesOrNull) {
  const { mkdir, writeFile, remove, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  const dir = rel.slice(0, rel.lastIndexOf('/'));
  await mkdir(dir, { ...base, recursive: true });
  if (bytesOrNull) await writeFile(rel, bytesOrNull, base);
  else await remove(rel, base).catch(() => {});
}

async function readRel(rel) {
  const { readFile, exists, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  if (!(await exists(rel, base))) return null;
  return readFile(rel, base);
}

/** Files the container has and IndexedDB no longer does: [absolutePath, bytes]. */
export async function restoreFiles() {
  if (!containerOn()) return [];
  const { readDir, readFile, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  const out = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await readDir(dir, base); } catch { return; }
    for (const entry of entries) {
      const child = `${dir}/${entry.name}`;
      const directory = entry.isDirectory === true || entry.is_directory === true;
      if (directory) await walk(child);
      else out.push(['/' + child.slice(`${FILES}/`.length), await readFile(child, base)]);
    }
  }
  await walk(FILES);
  return out.filter(([p]) => p.startsWith('/data/'));
}
