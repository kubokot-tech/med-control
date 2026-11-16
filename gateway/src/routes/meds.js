import { z } from 'zod';
import { UUID_RX } from '../lib/labsQuery.js';
import { DEFAULT_TZ } from '../lib/dates.js';
import { recordDose, deleteDose } from '../lib/medsRecord.js';
import { streakFor } from '../lib/medsStreak.js';
import { RULES } from '../lib/schedule.js';
import { createMedication } from '../lib/medsCreate.js';
import { doseNote } from '../lib/eventText.js';
import { userLanguage } from '../lib/userLocale.js';
import { listRegimens, updateMedication, listAdministrations, updateAdministration, doseHistory, changeDose, setDays } from '../lib/meds.js';

const SCHEDULE_FIELDS = {
  frequencyRule: z.enum(RULES).optional(),
  scheduleDays: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional(),
  intervalDays: z.number().int().min(2).max(90).nullable().optional(),
};

/** HTTP layer only: schemas, user and time zone from the token, the core in lib/meds*.js. */
export default async function medsRoutes(app) {
  app.get('/meds/regimens', { preHandler: app.authenticate }, async (req) => ({ regimens: await listRegimens(req.user.sub, { tz: req.user.tz || DEFAULT_TZ, language: await userLanguage(req.user.sub) }) }));

  // Medications: add a drug with its daily regimen (systemic or support), edit, stop.
  const MedBody = z.object({
    name: z.string().min(1).max(120), role: z.enum(['systemic', 'support']).default('support'),
    doseValue: z.number().positive().nullable().optional(), doseUnit: z.string().max(20).nullable().optional(),
    timesPerDay: z.number().int().min(1).max(6).default(1), remindAt: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    instructions: z.string().max(1000).nullable().optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), form: z.string().max(40).nullable().optional(),
    ...SCHEDULE_FIELDS,
  });
  app.post('/meds/medications', { preHandler: app.authenticate }, async (req, reply) => {
    const p = MedBody.safeParse(req.body); if (!p.success) return reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
    return createMedication(req.user.sub, p.data, req.user.tz || DEFAULT_TZ);
  });
  const MedPatch = z.object({
    name: z.string().min(1).max(120).optional(), role: z.enum(['systemic', 'support']).optional(), instructions: z.string().max(1000).nullable().optional(),
    remindAt: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), timesPerDay: z.number().int().min(1).max(6).optional(),
    stop: z.boolean().optional(), stopDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ...SCHEDULE_FIELDS,
  });
  app.patch('/meds/medications/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || ''); if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const p = MedPatch.safeParse(req.body); if (!p.success) return reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
    return { ok: true, items: await updateMedication(req.user.sub, id, p.data, { tz: req.user.tz || DEFAULT_TZ }) };
  });

  // List administrations (journal)
  app.get('/meds/administrations', { preHandler: app.authenticate }, async (req) => {
    const medId = (req.query?.medication_id || '').toString().trim();
    if (medId && !UUID_RX.test(medId)) return { administrations: [] };
    const from = (req.query?.from || '').toString().trim();
    const to = (req.query?.to || '').toString().trim();
    const language = await userLanguage(req.user.sub);
    const administrations = await listAdministrations(req.user.sub, { medicationId: medId || null, from, to, tz: req.user.tz || DEFAULT_TZ });
    return { administrations: administrations.map((a) => ({ ...a, notes: doseNote(a.notes, language) })) };
  });

  // Record administration (take or skip)
  const AdminBody = z.object({
    medication_id: z.string().uuid(),
    regimen_item_id: z.string().uuid().optional(),
    status: z.enum(['TAKEN', 'SKIPPED']),
    taken_at: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'bad date').optional(),
    dose_value: z.number().optional(),
    dose_unit: z.string().optional(),
    notes: z.string().optional(),
    dose_no: z.number().int().min(1).max(12).optional(),
  });

  app.post('/meds/administrations', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = AdminBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });

    const userId = req.user.sub;
    const { medication_id, regimen_item_id, status, taken_at, dose_value, dose_unit, notes, dose_no } = parsed.data;
    const tz = req.user.tz || DEFAULT_TZ;
    let r;
    try {
      r = await recordDose(userId, { medicationId: medication_id, regimenItemId: regimen_item_id, status, takenAt: taken_at, doseValue: dose_value, doseUnit: dose_unit, notes, doseNo: dose_no ?? null, tz, source: 'meds' });
    } catch (e) {
      if (e.code === 'medication_not_found') return reply.code(404).send({ error: 'medication_not_found' });
      if (e.code === 'bad_dose_no') return reply.code(400).send({ error: 'bad_dose_no' });
      throw e;
    }
    if (r.already) {
      return reply.code(409).send({ error: 'already_recorded', existing: r.already, message: `Приём за ${r.date} уже отмечен как ${r.already.status}` });
    }
    return { ok: true, id: r.id, status, date: r.date, doseNo: r.doseNo, times: r.times, taken: r.taken };
  });

  // Update administration
  app.patch('/meds/administrations/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const id = req.params?.id;
    if (!UUID_RX.test(id)) {
      return reply.code(400).send({ error: 'bad_id' });
    }

    const { status, notes } = req.body || {};
    return { ok: true, ...(await updateAdministration(userId, id, { status, notes })) };
  });

  // Dose history for a regimen item
  app.get('/meds/doses', { preHandler: app.authenticate }, async (req, reply) => {
    const itemId = String(req.query?.regimen_item_id || '');
    if (!UUID_RX.test(itemId)) return reply.code(400).send({ error: 'regimen_item_id_required' });
    const language = await userLanguage(req.user.sub);
    return { doses: (await doseHistory(req.user.sub, itemId)).map((d) => ({ ...d, reason: doseNote(d.reason, language) })) };
  });

  const DoseBody = z.object({
    regimen_item_id: z.string().uuid(),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dose_value: z.number().positive().max(1000),
    dose_unit: z.string().min(1).max(10).optional(),
    reason: z.string().max(500).optional(),
  });

  // Record a dose change; the regimen item takes the newest effective dose
  app.post('/meds/doses', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = DoseBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    const { regimen_item_id, effective_from, dose_value, dose_unit, reason } = parsed.data;
    return { ok: true, ...(await changeDose(req.user.sub, { regimenItemId: regimen_item_id, effectiveFrom: effective_from, doseValue: dose_value, doseUnit: dose_unit, reason, tz: req.user.tz || DEFAULT_TZ })) };
  });

  // Calendar: one status for every day in a past range, one record per day; CLEAR removes the records.
  const DaysBody = z.object({
    medication_id: z.string().uuid(),
    regimen_item_id: z.string().uuid().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['TAKEN', 'SKIPPED', 'PAUSED', 'CLEAR']),
  });
  app.put('/meds/administrations/days', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = DaysBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    const { medication_id, regimen_item_id, from, to, status } = parsed.data;
    return { ok: true, ...(await setDays(req.user.sub, { medicationId: medication_id, regimenItemId: regimen_item_id || null, from, to, status, tz: req.user.tz || DEFAULT_TZ })) };
  });

  // Delete an administration (undo) together with its timeline event
  app.delete('/meds/administrations/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const id = req.params?.id;
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const ok = await deleteDose(userId, id);
    return ok ? { ok: true, id } : reply.code(404).send({ error: 'not_found' });
  });

  // Streak: one cell per calendar day in the user's timezone. Days on a DAILY regimen without a
  // record are MISSED (except today, which is still open).
  app.get('/meds/streak', { preHandler: app.authenticate }, async (req, reply) => {
    const medId = (req.query?.medication_id || '').toString().trim();
    if (medId && !UUID_RX.test(medId)) return reply.code(400).send({ error: 'bad_id' });
    const days = Math.min(parseInt(req.query?.days || '30', 10) || 30, 365);
    return streakFor(req.user.sub, { medicationId: medId || null, days, tz: req.user.tz || DEFAULT_TZ });
  });
}
