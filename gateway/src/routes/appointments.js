import { z } from 'zod';
import { UUID_RX } from '../lib/labsQuery.js';
import { detectMime } from '../lib/attachmentsStore.js';
import { listAppointments, createAppointment, updateAppointment, deleteAppointment, generateQuestions, attachReport, upcoming } from '../lib/appointments.js';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  doctor: z.string().max(200).nullable().optional(),
  place: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
const Patch = Body.partial().extend({ status: z.enum(['planned', 'done', 'cancelled']).optional() });

export default async function appointmentsRoutes(app) {
  app.get('/appointments', { preHandler: app.authenticate }, async (req) => {
    const [items, up] = await Promise.all([listAppointments(req.user.sub), upcoming(req.user.sub, req.user.tz)]);
    return { appointments: items, next: up.next, overdue: up.overdue, today: up.today };
  });
  app.post('/appointments', { preHandler: app.authenticate }, async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
    return { ok: true, appointment: await createAppointment(req.user.sub, p.data) };
  });
  app.patch('/appointments/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const p = Patch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
    const a = await updateAppointment(req.user.sub, id, p.data);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, appointment: a };
  });
  app.delete('/appointments/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    return (await deleteAppointment(req.user.sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/appointments/:id/questions', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    try {
      const a = await generateQuestions(req.user.sub, id, { tz: req.user.tz });
      if (!a) return reply.code(404).send({ error: 'not_found' });
      return { ok: true, appointment: a };
    } catch (e) {
      if (e.code === 'no_api_key') return reply.code(503).send({ error: 'no_api_key', message: 'Ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'provider' || e.code === 'bad_output') return reply.code(502).send({ error: e.code, message: e.message });
      throw e;
    }
  });
  // Doctor's report: multipart files "file" (0..n) and optional text field "summary"
  app.post('/appointments/:id/report', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const files = [];
    let summary = '';
    if (req.isMultipart()) {
      for await (const p of req.parts()) {
        if (p.type === 'file' && p.fieldname === 'file') {
          const buf = await p.toBuffer();
          const mime = detectMime(p.mimetype, p.filename);
          if (buf.length && mime) files.push({ buf, mime, filename: p.filename });
        } else if (p.type === 'field' && p.fieldname === 'summary') summary = String(p.value || '').slice(0, 4000);
      }
    } else summary = String(req.body?.summary || '').slice(0, 4000);
    const r = await attachReport(req.user.sub, id, { files, summary, tz: req.user.tz });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, ...r };
  });
}
