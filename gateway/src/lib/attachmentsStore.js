/** Store an uploaded file (area uploads/milestones of the file store) and link it to an event. */
import crypto from 'node:crypto';
import * as fileStore from './files.js';

const AREA = 'uploads/milestones';
export const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']);
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };

/**
 * The type a stored file is served with. Anything outside the upload types becomes a plain download: the type column
 * can come from somebody else's archive (importArchive.js), and «text/html» or «image/svg+xml» served from our own
 * address would run as a page of the application.
 */
export const safeMime = (mime) => (ALLOWED_MIME.has(mime) ? mime : 'application/octet-stream');

/** Mime from the upload, falling back to the extension (phones sometimes send octet-stream). */
export function detectMime(mime, filename) {
  if (ALLOWED_MIME.has(mime)) return mime;
  const ext = String(filename || '').toLowerCase().split('.').pop();
  return { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp' }[ext] || null;
}

export async function storeAttachment(db, userId, eventId, buf, mime, filename) {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const filePath = await fileStore.put(AREA, `${sha256}.${EXT[mime]}`, buf);
  await db.query(
    `insert into attachments (user_id, event_id, file_url, mime_type, sha256, filename) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
    [userId, eventId, filePath, mime, sha256, filename || null]
  );
  return { sha256, filename: filename || null, mimeType: mime };
}
