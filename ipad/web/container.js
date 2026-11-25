// A copy of the iPad data outside WKWebView. IndexedDB can be wiped; the app container is not.
// Paths are relative to the app data directory: medcontrol/files/data/… and medcontrol/pgdata.tar.

const ROOT = 'medcontrol';
const FILES = `${ROOT}/files`;

export const containerOn = () => typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function';

const plugin = () => import('@tauri-apps/plugin-fs');

let chain = Promise.resolve();

export function queueFile(absPath, bytesOrNull) {
  if (!containerOn() || !String(absPath).startsWith('/data/')) return Promise.resolve(false);
  const rel = `${FILES}${absPath}`;
  // The shim owns this immutable buffer; each overwrite replaces the buffer in its map.
  const write = chain.then(() => writeRel(rel, bytesOrNull));
  chain = write.catch(() => {});
  return write.then(() => true);
}

let keepPrevious = false;

export async function readDatabaseCopy(validate, read = readRel) {
  let failure;
  for (const name of ['pgdata.tar', 'pgdata.tar.prev', 'pgdata.tar.tmp']) {
    try {
      const bytes = await read(`${ROOT}/${name}`);
      if (!bytes) continue;
      const blob = new Blob([bytes]);
      // Snapshots written by dumpDataDir() are gzip-compressed tar archives.
      // Drain gzip first so a damaged stream cannot leave PGlite half initialized.
      await blob.stream().pipeThrough(new DecompressionStream('gzip')).pipeTo(new WritableStream());
      await validate(blob);
      keepPrevious = name !== 'pgdata.tar';
      return { blob, generation: name };
    } catch (e) { failure = e; }
  }
  if (failure) throw new Error('No readable database snapshot', { cause: failure });
  return null;
}

export function writeDatabaseCopy(bytes) {
  if (!containerOn()) return Promise.resolve(false);
  return writeTar(bytes);
}

async function writeTar(bytes) {
  const { writeFile, rename, mkdir, exists, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  const dirs = { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData };
  await mkdir(ROOT, { ...base, recursive: true });
  const tmp = `${ROOT}/pgdata.tar.tmp`;
  const dest = `${ROOT}/pgdata.tar`;
  const prev = `${ROOT}/pgdata.tar.prev`;
  await writeFile(tmp, bytes, base);
  // Each rename is atomic: at any crash moment at least one of dest/prev/tmp is a complete copy.
  // The old copy becomes the previous generation instead of being deleted first.
  if (!keepPrevious && await exists(dest, base)) await rename(dest, prev, dirs);
  await rename(tmp, dest, dirs);
  keepPrevious = false;
  return true;
}

async function writeRel(rel, bytesOrNull) {
  const { mkdir, writeFile, exists, remove, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  const dir = rel.slice(0, rel.lastIndexOf('/'));
  await mkdir(dir, { ...base, recursive: true });
  if (bytesOrNull) await writeFile(rel, bytesOrNull, base);
  else if (await exists(rel, base)) await remove(rel, base);
}

async function readRel(rel) {
  const { readFile, exists, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  if (!(await exists(rel, base))) return null;
  return readFile(rel, base);
}

/** Enumerate paths without reading attachment bodies. Read missing files one at a time. */
export async function* containerFiles() {
  if (!containerOn()) return;
  const { exists, readDir, readFile, stat, BaseDirectory } = await plugin();
  const base = { baseDir: BaseDirectory.AppData };
  if (!(await exists(FILES, base))) return;
  async function* walk(dir) {
    for (const entry of await readDir(dir, base)) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory) yield* walk(child);
      else {
        const path = '/' + child.slice(`${FILES}/`.length);
        if (path.startsWith('/data/')) {
          yield { path, read: () => readFile(child, base), stat: () => stat(child, base) };
        }
      }
    }
  }
  yield* walk(FILES);
}
