import { z } from 'zod';
import { pool, transaction, abort } from '../lib/db.js';
import { DEFAULT_TZ, todayKey } from '../lib/dates.js';
import { rowToEntry, saveSymptoms } from '../lib/symptoms.js';
import { SCALE_KEYS } from '../lib/diaryScales.js';

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const scale3 = z.number().int().min(0).max(3).nullable().optional();

const Body = z.object({
  wellbeing: z.number().int().min(1).max(5).nullable().optional(),
  ...Object.fromEntries(SCALE_KEYS.map((k) => [k, scale3])),
  tempC: z.number().min(34).max(43).nullable().optional(),
  bpSys: z.number().int().min(60).max(260).nullable().optional(),
  bpDia: z.number().int().min(30).max(160).nullable().optional(),
  weightKg: z.number().min(20).max(300).nullable().optional(),
  pulse: z.number().int().min(25).max(250).nullable().optional(),
  steps: z.number().int().min(0).max(200000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export default async function symptomsRoutes(app) {
  // Diary entries, newest first
  app.get('/symptoms', { preHandler: app.authenticate }, async (req) => {
    const userId = req.user.sub;
    const tz = req.user.tz || DEFAULT_TZ;
    const days = Math.min(Math.max(parseInt(req.query?.days || '60', 10) || 60, 1), 400);
    const r = await pool.query(
      `select * from symptom_entries
       where user_id = $1 and date >= (current_date - ($2::int))
       order by date desc`,
      [userId, days]
    );
    return { today: todayKey(tz), entries: r.rows.map(rowToEntry) };
  });

  app.get('/symptoms/:date', { preHandler: app.authenticate }, async (req, reply) => {
    const date = String(req.params?.date || '');
    if (!DAY_RX.test(date)) return reply.code(400).send({ error: 'bad_date' });
    const r = await pool.query('select * from symptom_entries where user_id = $1 and date = $2', [req.user.sub, date]);
    if (!r.rows.length) return reply.code(404).send({ error: 'not_found' });
    return { entry: rowToEntry(r.rows[0]) };
  });

  // Upsert the entry for a day and mirror it as a SYMPTOM event in the timeline
  app.put('/symptoms/:date', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const tz = req.user.tz || DEFAULT_TZ;
    const date = String(req.params?.date || '');
    if (!DAY_RX.test(date)) return reply.code(400).send({ error: 'bad_date' });
    if (date > todayKey(tz)) return reply.code(400).send({ error: 'future_date' });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    try {
      const { entry, alertsRaised } = await saveSymptoms(userId, date, parsed.data, tz);
      return { ok: true, entry, alertsRaised };
    } catch (e) {
      if (e.code === 'nothing_to_save') return reply.code(400).send({ error: 'nothing_to_save' });
      throw e;
    }
  });

  app.delete('/symptoms/:date', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const tz = req.user.tz || DEFAULT_TZ;
    const date = String(req.params?.date || '');
    if (!DAY_RX.test(date)) return reply.code(400).send({ error: 'bad_date' });
    const found = await transaction(async (client) => {
      const del = await client.query('delete from symptom_entries where user_id = $1 and date = $2 returning id', [userId, date]);
      if (!del.rows.length) abort(false);
      await client.query(
        `delete from events where user_id = $1 and type = 'SYMPTOM' and to_char(occurred_at at time zone $2, 'YYYY-MM-DD') = $3`,
        [userId, tz, date]
      );
      return true;
    });
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
