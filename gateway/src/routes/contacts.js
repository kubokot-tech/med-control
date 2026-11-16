import { z } from 'zod';
import { UUID_RX } from '../lib/labsQuery.js';
import { listContacts, createContact, updateContact, deleteContact } from '../lib/contacts.js';

const text = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const Body = z.object({
  name: z.string().trim().min(1).max(120),
  role: text(120),
  clinic: text(200),
  phones: z.array(z.string().trim().max(40).regex(/^[0-9+()\-.\s,#*добext]*$/i, 'phone')).max(5).optional().transform((a) => (a || []).filter(Boolean)),
  email: z.string().trim().max(200).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'email').nullable().optional().transform((v) => v || null),
  address: text(300),
  url: z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\//i.test(v), 'only http(s) links').nullable().optional().transform((v) => v || null),
  notes: text(2000),
  pinned: z.boolean().optional(),
});
const bad = (reply, p) => reply.code(400).send({ error: 'invalid_body', details: p.error.issues });

/** Doctors and other contacts: HTTP layer for lib/contacts.js. */
export default async function contactsRoutes(app) {
  app.get('/contacts', { preHandler: app.authenticate }, async (req) => ({ contacts: await listContacts(req.user.sub) }));
  app.post('/contacts', { preHandler: app.authenticate }, async (req, reply) => {
    const p = Body.safeParse(req.body); if (!p.success) return bad(reply, p);
    return { ok: true, contact: await createContact(req.user.sub, p.data) };
  });
  app.patch('/contacts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const p = Body.partial().safeParse(req.body); if (!p.success) return bad(reply, p);
    // partial(): keep only the fields that came in the request
    const patch = Object.fromEntries(Object.entries(p.data).filter(([k]) => k in (req.body || {})));
    return { ok: true, contact: await updateContact(req.user.sub, id, patch) };
  });
  app.delete('/contacts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    await deleteContact(req.user.sub, id);
    return { ok: true };
  });
}
