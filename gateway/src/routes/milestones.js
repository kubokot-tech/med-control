import { z } from 'zod';
import { detectMime } from '../lib/attachmentsStore.js';
import { firstFilePart } from '../lib/multipart.js';
import { extractOrReply, getExtract } from '../lib/extracts.js';
import { UUID_RX } from '../lib/labsQuery.js';
import { DEFAULT_TZ } from '../lib/dates.js';
import { userLanguage } from '../lib/userLocale.js';
import {
  KINDS, TONES, kindLabels, listMilestones, createMilestone, updateMilestone, deleteMilestone, createMilestonesBatch,
  attachToMilestone, milestoneHasFile, insertExtractIntoNotes, removeMilestoneFile,
} from '../lib/milestones.js';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(KINDS),
  tone: z.enum(TONES).default('neutral'),
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).nullable().optional(),
});
// No default on tone: zod 4 applies defaults inside partial(), and a PATCH without tone would reset it.
export const MilestonePatch = Body.extend({ tone: z.enum(TONES) }).partial();

// Batch: multipart field "meta" = JSON array [{ date, kind, title, tone?, modality?, region? }], then files "file" in the same order.
export const BatchMeta = z.array(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(KINDS.filter((k) => k !== 'ai_review')),
  title: z.string().min(1).max(200),
  tone: z.enum(TONES).default('neutral'),
  modality: z.string().max(40).optional(),
  region: z.string().max(120).optional(),
})).min(1).max(50);

const SHA_RX = /^[a-f0-9]{64}$/i;

/** HTTP layer for the milestones core (lib/milestones.js): schemas, multipart, user and time zone from the token. */
export default async function milestonesRoutes(app) {
  app.get('/milestones', { preHandler: app.authenticate }, async (req) => { const language = await userLanguage(req.user.sub); return { milestones: await listMilestones(req.user.sub, { language }), kinds: kindLabels(language) }; });

  app.post('/milestones', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    return { ok: true, milestone: await createMilestone(req.user.sub, parsed.data, { tz: req.user.tz || DEFAULT_TZ }) };
  });

  app.patch('/milestones/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const parsed = MilestonePatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    return { ok: true, milestone: await updateMilestone(req.user.sub, id, parsed.data, { tz: req.user.tz || DEFAULT_TZ }) };
  });

  app.delete('/milestones/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    await deleteMilestone(req.user.sub, id);
    return { ok: true };
  });

  app.post('/milestones/batch', { preHandler: app.authenticate }, async (req, reply) => {
    let meta = null;
    const files = [];
    for await (const p of req.parts()) {
      if (p.type === 'field' && p.fieldname === 'meta') {
        try { meta = JSON.parse(String(p.value)); } catch { return reply.code(400).send({ error: 'bad_meta' }); }
      } else if (p.type === 'file' && p.fieldname === 'file') {
        files.push({ filename: p.filename, mimetype: p.mimetype, buf: await p.toBuffer() });
      }
    }
    const parsed = BatchMeta.safeParse(meta);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_meta', details: parsed.error.issues });
    if (parsed.data.length !== files.length) return reply.code(400).send({ error: 'meta_files_mismatch', meta: parsed.data.length, files: files.length });
    const items = parsed.data.map((m, i) => ({ meta: m, file: files[i] }));
    return createMilestonesBatch(req.user.sub, items, { tz: req.user.tz || DEFAULT_TZ, log: req.log });
  });

  // Attach a file (PDF or photo) to a milestone
  app.post('/milestones/:id/attachments', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const { buf, filename, mimetype } = await firstFilePart(req);
    if (!buf?.length) return reply.code(400).send({ error: buf ? 'empty_file' : 'file_required' });
    const mime = detectMime(mimetype, filename);
    if (!mime) return reply.code(415).send({ error: 'unsupported_type', mime: mimetype });
    return { ok: true, attachment: await attachToMilestone(req.user.sub, id, { buf, mime, filename }, { log: req.log }) };
  });

  // Text of an attached file (see lib/extracts.js): stored text, extract or re-extract, append to the comment
  const fileParams = (req, reply) => {
    const id = String(req.params?.id || ''); const sha = String(req.params?.sha256 || '');
    if (!UUID_RX.test(id) || !SHA_RX.test(sha)) { reply.code(400).send({ error: 'bad_id' }); return null; }
    return { id, sha };
  };
  app.get('/milestones/:id/attachments/:sha256/extract', { preHandler: app.authenticate }, async (req, reply) => {
    const p = fileParams(req, reply); if (!p) return reply;
    if (!(await milestoneHasFile(req.user.sub, p.id, p.sha))) return reply.code(404).send({ error: 'not_found' });
    const x = await getExtract(req.user.sub, p.sha);
    return x ? { extract: x } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/milestones/:id/attachments/:sha256/extract', { preHandler: app.authenticate }, async (req, reply) => {
    const p = fileParams(req, reply); if (!p) return reply;
    if (!(await milestoneHasFile(req.user.sub, p.id, p.sha))) return reply.code(404).send({ error: 'not_found' });
    const mode = ['auto', 'text', 'ocr', 'llm', 'summary'].includes(req.query?.mode) ? req.query.mode : 'auto';
    return extractOrReply(reply, req.user.sub, p.sha, mode);
  });
  app.post('/milestones/:id/attachments/:sha256/extract/insert', { preHandler: app.authenticate }, async (req, reply) => {
    const p = fileParams(req, reply); if (!p) return reply;
    return { ok: true, notes: await insertExtractIntoNotes(req.user.sub, p.id, p.sha, { variant: req.query?.variant === 'summary' ? 'summary' : 'full' }) };
  });

  app.delete('/milestones/:id/attachments/:sha256', { preHandler: app.authenticate }, async (req, reply) => {
    const p = fileParams(req, reply); if (!p) return reply;
    await removeMilestoneFile(req.user.sub, p.id, p.sha);
    return { ok: true };
  });
}
