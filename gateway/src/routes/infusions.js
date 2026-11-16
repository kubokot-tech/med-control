import { z } from 'zod';
import { UUID_RX } from '../lib/labsQuery.js';
import { listAgents, createAgent, updateAgent, deleteAgent, listInfusions, createInfusion, updateInfusion, deleteInfusion, listCourses, createCourse, updateCourse, deleteCourse } from '../lib/infusions.js';

const AgentBody = z.object({
  name: z.string().min(1).max(120), shortName: z.string().max(40).nullable().optional(), defaultDose: z.number().nonnegative().nullable().optional(),
  doseUnit: z.string().max(20).nullable().optional(), route: z.string().max(60).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(), sortOrder: z.number().int().optional(),
});
const InfusionBody = z.object({
  agentId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  doseValue: z.number().nonnegative().nullable().optional(), doseUnit: z.string().max(20).nullable().optional(), durationMin: z.number().int().nonnegative().nullable().optional(),
  place: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional(), reaction: z.string().max(1000).nullable().optional(),
  courseId: z.string().uuid().nullable().optional(), route: z.string().max(60).nullable().optional(),
});
const CourseBody = z.object({
  agentId: z.string().uuid(), title: z.string().max(120).nullable().optional(), plannedCount: z.number().int().min(1).max(365).nullable().optional(),
  cadenceDays: z.number().int().min(1).max(365).nullable().optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['active', 'done', 'cancelled']).optional(), remind: z.boolean().optional(), notes: z.string().max(2000).nullable().optional(),
});
const bad = (reply, p) => reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
const badId = (reply) => reply.code(400).send({ error: 'bad_id' });

export default async function infusionsRoutes(app) {
  app.get('/infusions', { preHandler: app.authenticate }, async (req) => {
    const [agents, items, courses] = await Promise.all([listAgents(req.user.sub), listInfusions(req.user.sub, { from: req.query?.from, to: req.query?.to }), listCourses(req.user.sub)]);
    return { agents, infusions: items, courses };
  });
  app.post('/infusions/courses', { preHandler: app.authenticate }, async (req, reply) => {
    const p = CourseBody.safeParse(req.body); if (!p.success) return bad(reply, p);
    try { return { ok: true, course: await createCourse(req.user.sub, p.data) }; }
    catch (e) { if (e.code === 'agent_not_found') return reply.code(404).send({ error: 'agent_not_found' }); throw e; }
  });
  app.patch('/infusions/courses/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    const p = CourseBody.partial().safeParse(req.body); if (!p.success) return bad(reply, p);
    const c = await updateCourse(req.user.sub, id, p.data);
    return c ? { ok: true, course: c } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/infusions/courses/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    return (await deleteCourse(req.user.sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/infusions/agents', { preHandler: app.authenticate }, async (req, reply) => {
    const p = AgentBody.safeParse(req.body); if (!p.success) return bad(reply, p);
    try { return { ok: true, agent: await createAgent(req.user.sub, p.data) }; }
    catch (e) { if (e.code === '23505') return reply.code(409).send({ error: 'duplicate', message: 'Такое название уже есть' }); throw e; }
  });
  app.patch('/infusions/agents/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    const p = AgentBody.partial().safeParse(req.body); if (!p.success) return bad(reply, p);
    const a = await updateAgent(req.user.sub, id, p.data);
    return a ? { ok: true, agent: a } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/infusions/agents/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    try { return (await deleteAgent(req.user.sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' }); }
    catch (e) { if (e.code === 'in_use') return reply.code(409).send({ error: 'in_use', message: `По этому препарату есть записи (${e.count}). Скройте его вместо удаления.` }); throw e; }
  });
  app.post('/infusions', { preHandler: app.authenticate }, async (req, reply) => {
    const p = InfusionBody.safeParse(req.body); if (!p.success) return bad(reply, p);
    try { return { ok: true, infusion: await createInfusion(req.user.sub, p.data, req.user.tz) }; }
    catch (e) { if (e.code === 'agent_not_found') return reply.code(404).send({ error: 'agent_not_found' }); throw e; }
  });
  app.patch('/infusions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    const p = InfusionBody.partial().safeParse(req.body); if (!p.success) return bad(reply, p);
    const x = await updateInfusion(req.user.sub, id, p.data, req.user.tz);
    return x ? { ok: true, infusion: x } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/infusions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return badId(reply);
    return (await deleteInfusion(req.user.sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
