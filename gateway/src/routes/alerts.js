import { pool, transaction } from '../lib/db.js';
import { UUID_RX } from '../lib/labsQuery.js';
import { labFindings, symptomFindings, raiseAlerts, rowToAlert } from '../lib/alerts.js';
import { DEFAULT_TZ } from '../lib/dates.js';
import { userFormat } from '../lib/userLocale.js';

export default async function alertsRoutes(app) {
  // Open alerts by default; ?status=all for history
  app.get('/alerts', { preHandler: app.authenticate }, async (req) => {
    const userId = req.user.sub;
    const status = (req.query?.status || 'open').toString().toLowerCase();
    const wanted = status === 'all' ? null : status === 'open' ? 'OPEN' : ['ACK', 'RESOLVED'].includes(status.toUpperCase()) ? status.toUpperCase() : 'OPEN';
    const where = wanted ? `and status = '${wanted}'` : '';
    const r = await pool.query(
      `select id, triggered_at, status, context from alerts where user_id = $1 ${where}
       order by (context->>'severity' = 'RED') desc, triggered_at desc limit 200`,
      [userId]
    );
    const format = await userFormat(userId);
    return { alerts: r.rows.map((x) => rowToAlert(x, format)) };
  });

  app.patch('/alerts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });
    const status = String(req.body?.status || '').toUpperCase();
    if (!['OPEN', 'ACK', 'RESOLVED'].includes(status)) return reply.code(400).send({ error: 'bad_status' });
    const r = await pool.query('update alerts set status = $3 where user_id = $1 and id = $2 returning id, status', [req.user.sub, id, status]);
    if (!r.rows.length) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, id, status };
  });

  // Re-evaluate the latest value of every marker and the last 30 diary days (idempotent)
  app.post('/alerts/recheck', { preHandler: app.authenticate }, async (req) => {
    const userId = req.user.sub;
    const tz = req.user.tz || DEFAULT_TZ;
    const labs = await pool.query(
      `select distinct on (t.canonical_key) t.canonical_key as key, t.code, r.value_numeric, r.unit_canonical, r.ref_low, r.ref_high, r.source_event_id, r.collected_at
       from lab_results_eff r join lab_tests t on t.id = r.test_id
       where r.user_id = $1 and t.canonical_key is not null and r.value_numeric is not null
       order by t.canonical_key, r.collected_at desc`,
      [userId]
    );
    const format = await userFormat(userId);
    const findings = labFindings(
      labs.rows.map((x) => ({ key: x.key, code: x.code, value: x.value_numeric, unit: x.unit_canonical, refLow: x.ref_low, refHigh: x.ref_high, eventId: x.source_event_id })),
      { format },
    ).map((f, i) => ({ ...f, dedup: `lab:${f.key}:${labs.rows.find((x) => x.key === f.key)?.source_event_id || 'x'}` }));

    const sym = await pool.query(`select * from symptom_entries where user_id = $1 and date >= current_date - 30`, [userId]);
    for (const row of sym.rows) {
      const date = new Date(row.date).toISOString().slice(0, 10);
      findings.push(...symptomFindings({ bpSys: row.bp_sys, bpDia: row.bp_dia, tempC: row.temp_c != null ? Number(row.temp_c) : null, diarrhea: row.diarrhea, handFoot: row.hand_foot, nausea: row.nausea }, date, format.language));
    }
    const n = await transaction((client) => raiseAlerts(client, userId, findings));
    return { ok: true, evaluated: findings.length, inserted: n, tz };
  });
}
