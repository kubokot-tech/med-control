/**
 * File store for the user's files: lab PDFs, attachments, pending AI drafts. The rest of the core keeps the
 * ref returned by put() (that is what attachments.file_url stores) and never touches node:fs itself, so a
 * local build can swap this module for OPFS or the Tauri file API without changing the callers.
 *
 * Server build: files live under DATA_DIR (env DTC_DATA_DIR, default /data); an area is a subdirectory
 * ('uploads', 'uploads/milestones', 'uploads/pending') and a ref is the absolute path, as file_url has always
 * held. Server-only files (jwt.secret, the backup status, migrations, the DICOM import folder) stay outside.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const AREA_RX = /^[a-z]+(\/[a-z]+)*$/;
const NAME_RX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Read at call time: tests point DTC_DATA_DIR at a temporary directory before using the store. */
export const root = () => process.env.DTC_DATA_DIR || '/data';

function areaDir(area) {
  if (!AREA_RX.test(String(area))) throw new Error(`bad file area: ${area}`);
  return path.join(root(), area);
}

/** The ref a file in this area would have (no I/O). */
export function refOf(area, name) {
  if (!NAME_RX.test(String(name))) throw new Error(`bad file name: ${name}`);
  return path.join(areaDir(area), name);
}

/** Write (or overwrite) a file; returns its ref. */
export async function put(area, name, data) {
  const ref = refOf(area, name);
  await fs.mkdir(path.dirname(ref), { recursive: true });
  await fs.writeFile(ref, data);
  return ref;
}

export async function read(ref) { return fs.readFile(ref); }
export async function readText(ref) { return fs.readFile(ref, 'utf8'); }

/** A readable stream for HTTP responses and the export archive (server build only). */
export function stream(ref) { return createReadStream(ref); }

export async function exists(ref) {
  try { await fs.access(ref); return true; } catch { return false; }
}

/** Delete a file; a missing file is not an error. Returns whether something was removed. */
export async function remove(ref) {
  try { await fs.unlink(ref); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

/**
 * Files of an area, oldest first: { name, ref, mtimeMs }. With recursive, names are relative paths
 * ('milestones/abc.pdf'). A missing area is an empty list.
 */
export async function list(area, { recursive = false } = {}) {
  const dir = areaDir(area);
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true, recursive }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const d of entries) {
    if (!d.isFile()) continue;
    const ref = path.join(d.parentPath ?? d.path ?? dir, d.name);
    const st = await fs.stat(ref).catch(() => null);
    if (st) out.push({ name: path.relative(dir, ref), ref, mtimeMs: st.mtimeMs });
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
}
