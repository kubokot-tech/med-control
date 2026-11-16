import * as fileStore from '../lib/files.js';
import { pool } from '../lib/db.js';
import { safeMime } from '../lib/attachmentsStore.js';

export default async function attachmentsRoutes(app) {
  // Download attachment by sha256 (PDF stored in /data/uploads)
  app.get('/attachments/:sha256', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const sha256 = (req.params?.sha256 || '').toString();
    if (!/^[a-f0-9]{64}$/i.test(sha256)) return reply.code(400).send({ error: 'bad_sha256' });

    const r = await pool.query(
      'select file_url, mime_type, filename from attachments where user_id=$1 and sha256=$2 limit 1',
      [userId, sha256]
    );
    if (!r.rows.length) return reply.code(404).send({ error: 'not_found' });

    const fileUrl = r.rows[0].file_url;
    // only the upload types are served as what they claim to be; a row from an old import may say anything
    const mime = safeMime(r.rows[0].mime_type);

    if (!(await fileStore.exists(fileUrl))) return reply.code(404).send({ error: 'file_missing' });

    const ext = mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? mime.split('/')[1].replace('jpeg', 'jpg') : 'bin';
    const name = r.rows[0].filename || `${sha256.slice(0, 12)}.${ext}`;
    const inline = req.query?.inline === '1' && mime !== 'application/octet-stream';
    reply.header('Content-Type', mime);
    // edge and Next add this header too; the desktop gateway and anything reading it directly rely on this one
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(fileStore.stream(fileUrl));
  });
}
