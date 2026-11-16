import { z } from 'zod';
import { pool } from '../lib/db.js';
import { UUID_RX } from '../lib/labsQuery.js';
import { listNotes, listTags, getNote, createNote, updateNote, deleteNote, parseMarkdownImport } from '../lib/notes.js';
import { storeAttachment, detectMime } from '../lib/attachmentsStore.js';
import { commentNote } from '../lib/notesAi.js';
import { latestComment } from '../lib/labsAi.js';
import { extractAttachment, getExtract, insertExtractIntoNote, listExtracts } from '../lib/notesExtract.js';
import { extractOrReply } from '../lib/extracts.js';

const Body = z.object({ title: z.string().max(200).optional(), body: z.string().max(200_000).optional(), tags: z.array(z.string().max(40)).max(20).optional(), url: z.string().max(1000).refine((u) => u === '' || /^https?:\/\//i.test(u), 'only http(s) links').nullable().optional(), pinned: z.boolean().optional() });
const bad = (reply, p) => reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
const badId = (reply) => reply.code(400).send({ error: 'bad_id' });

export default async function notesRoutes(app) {
  app.get('/notes', { preHandler: app.authenticate }, async (req) => {
    const q = String(req.query?.q || '').trim().slice(0, 100);
    const tag = String(req.query?.tag || '').trim().slice(0, 40);
    const [notes, tags] = await Promise.all([listNotes(req.user.sub, { q: q || undefined, tag: tag || undefined }), listTags(req.user.sub)]);
    return { notes, tags };
  });
  app.get('/notes/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    const n = await getNote(req.user.sub, id);
    if (!n) return reply.code(404).send({ error: 'not_found' });
    const ex = await listExtracts(req.user.sub, id);
    n.files = n.files.map((f) => ({ ...f, extract: ex.find((x) => x.sha256 === f.sha256) || null }));
    return n;
  });
  app.post('/notes', { preHandler: app.authenticate }, async (req, reply) => {
    const p = Body.safeParse(req.body); if (!p.success) return bad(reply, p);
    return { ok: true, note: await createNote(req.user.sub, p.data, { tz: req.user.tz }) };
  });
  app.patch('/notes/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    const p = Body.safeParse(req.body); if (!p.success) return bad(reply, p);
    const n = await updateNote(req.user.sub, id, p.data, req.user.tz);
    return n ? { ok: true, note: n } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/notes/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    return (await deleteNote(req.user.sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // Import .md / .txt files (one note per file): front matter and the first heading become title/tags/url.
  app.post('/notes/import', { preHandler: app.authenticate }, async (req, reply) => {
    const created = []; const skipped = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const name = part.filename || 'import.md';
      if (!/\.(md|markdown|txt)$/i.test(name)) { await part.toBuffer(); skipped.push({ name, reason: 'not_markdown' }); continue; }
      const buf = await part.toBuffer();
      if (!buf.length || buf.length > 2_000_000) { skipped.push({ name, reason: buf.length ? 'too_big' : 'empty' }); continue; }
      const parsed = parseMarkdownImport(buf.toString('utf8'), name);
      const n = await createNote(req.user.sub, parsed, { tz: req.user.tz, source: 'import', sourceName: parsed.sourceName || name });
      created.push({ id: n.id, title: n.title });
    }
    if (!created.length && !skipped.length) return reply.code(400).send({ error: 'file_required' });
    return { ok: true, created, skipped };
  });

  app.post('/notes/:id/files', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    const cur = await pool.query('select event_id from notes where user_id = $1 and id = $2', [req.user.sub, id]);
    if (!cur.rows.length || !cur.rows[0].event_id) return reply.code(404).send({ error: 'not_found' });
    const out = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      if (!buf.length) continue;
      const mime = detectMime(part.mimetype, part.filename);
      if (!mime) return reply.code(415).send({ error: 'unsupported_type', mime: part.mimetype });
      out.push(await storeAttachment(pool, req.user.sub, cur.rows[0].event_id, buf, mime, part.filename));
    }
    if (!out.length) return reply.code(400).send({ error: 'file_required' });
    await pool.query('update notes set updated_at = now() where id = $1', [id]);
    // PDFs with a text layer are extracted right away so the AI sees them; scans wait for the user's «через ИИ»
    const { autoExtract } = await import('../lib/extracts.js');
    await autoExtract(req.user.sub, out, req.log);
    return { ok: true, files: out };
  });
  app.delete('/notes/:id/files/:sha256', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); const sha = String(req.params?.sha256 || '');
    if (!UUID_RX.test(id) || !/^[a-f0-9]{64}$/i.test(sha)) return badId(reply);
    const cur = await pool.query('select event_id from notes where user_id = $1 and id = $2', [req.user.sub, id]);
    if (!cur.rows.length) return reply.code(404).send({ error: 'not_found' });
    const del = await pool.query('delete from attachments where user_id = $1 and event_id = $2 and sha256 = $3 returning file_url', [req.user.sub, cur.rows[0].event_id, sha]);
    if (!del.rows.length) return reply.code(404).send({ error: 'not_found' });
    const { releaseFile } = await import('../lib/extracts.js');
    await releaseFile(req.user.sub, sha, del.rows[0].file_url);
    return { ok: true };
  });

  // Text of an attached file: GET (stored), POST ?mode=auto|text|ocr|llm (extract or re-extract), POST /insert (append to the note)
  app.get('/notes/:id/files/:sha256/extract', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); const sha = String(req.params?.sha256 || '');
    if (!UUID_RX.test(id) || !/^[a-f0-9]{64}$/i.test(sha)) return badId(reply);
    const x = await getExtract(req.user.sub, id, sha);
    return x ? { extract: x } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/notes/:id/files/:sha256/extract', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); const sha = String(req.params?.sha256 || '');
    if (!UUID_RX.test(id) || !/^[a-f0-9]{64}$/i.test(sha)) return badId(reply);
    const mode = ['auto', 'text', 'ocr', 'llm', 'summary'].includes(req.query?.mode) ? req.query.mode : 'auto';
    const own = await pool.query('select 1 from notes n join attachments a on a.event_id = n.event_id where n.user_id = $1 and n.id = $2 and a.sha256 = $3', [req.user.sub, id, sha]);
    if (!own.rows.length) return reply.code(404).send({ error: 'not_found' });
    return extractOrReply(reply, req.user.sub, sha, mode);
  });
  app.post('/notes/:id/files/:sha256/extract/insert', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); const sha = String(req.params?.sha256 || '');
    if (!UUID_RX.test(id) || !/^[a-f0-9]{64}$/i.test(sha)) return badId(reply);
    const n = await insertExtractIntoNote(req.user.sub, id, sha, { variant: req.query?.variant === 'summary' ? 'summary' : 'full' });
    return n ? { ok: true, note: n } : reply.code(404).send({ error: 'not_found' });
  });

  // AI: how the note relates to this patient's case (+ follow-up questions via /ai/ask subject 'note')
  app.get('/ai/comments/note/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    return { comment: await latestComment(req.user.sub, 'note', id) };
  });
  app.post('/ai/comments/note/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    try {
      const c = await commentNote(req.user.sub, id, { tz: req.user.tz });
      return c ? { comment: c } : reply.code(404).send({ error: 'not_found' });
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
}
