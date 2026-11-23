/** Multipart reading shared by the HTTP routes and the iPad's in-page direct calls (ipad/web/gateway-entry.js). */

/**
 * The first file part named `file`, its bytes and name. The iterator is drained to the end: stopping early
 * leaves the parser waiting and the upload never finishes. Extra file parts are discarded without buffering.
 */
export async function firstFilePart(req) {
  let buf = null;
  let filename = null;
  let mimetype = null;
  for await (const p of req.parts()) {
    if (p.type !== 'file') continue;
    if (!buf && p.fieldname === 'file') { buf = await p.toBuffer(); filename = p.filename; mimetype = p.mimetype; }
    else p.file.resume();
  }
  return { buf, filename, mimetype };
}
