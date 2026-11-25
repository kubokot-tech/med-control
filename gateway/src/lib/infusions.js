/** Infusions: agents catalog (seeded once per user) and the sessions log with feed events. */
import { pool, transaction } from './db.js';
import { DEFAULT_TZ } from './dates.js';
import { addEvent, updateEvent, deleteEvent } from './feed.js';
import { raiseAlerts } from './alerts.js';
import { addDays } from './dates.js';
import { getProtocol, protocolIn, presetVariants } from './protocol.js';
import { ROUTES, ROUTE_IV_DRIP, isShotRoute } from '../../../shared/medCodes.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

export { ROUTES };

/** Insert the protocol's infusion agents that are not in the catalog yet. Returns the number added. */
export async function addProtocolAgents(userId, language) {
  let added = 0;
  for (const a of protocolIn(getProtocol(), language).infusionAgents) {
    // the same preset agent added earlier in another language is the same agent
    const r = await pool.query(`insert into infusion_agents (user_id, name, short_name, default_dose, dose_unit, notes, sort_order)
      select $1,$2,$3,$4,$5,$6,$7 where not exists (select 1 from infusion_agents where user_id = $1 and name = any($8::text[])) on conflict (user_id, name) do nothing`,
    [userId, a.name, a.shortName || null, a.defaultDose ?? null, a.doseUnit || null, a.notes || null, a.sortOrder ?? 100, presetVariants(a.name)]);
    added += r.rowCount;
  }
  return added;
}
/** First use: seed the catalog from the protocol when it is empty. */
export async function ensureSeedAgents(userId) {
  const n = (await pool.query('select count(*)::int as n from infusion_agents where user_id = $1', [userId])).rows[0].n;
  if (n > 0) return 0;
  return addProtocolAgents(userId, await userLanguage(userId));
}

const toAgent = (r) => ({ id: r.id, name: r.name, shortName: r.short_name, defaultDose: r.default_dose != null ? Number(r.default_dose) : null, doseUnit: r.dose_unit, route: r.route, notes: r.notes, active: r.active, sortOrder: r.sort_order, count: r.count != null ? Number(r.count) : undefined, lastDate: r.last_date || null });
export const routeKind = (route) => (/капельн/i.test(route || '') ? 'drip' : isShotRoute(route) ? 'shot' : 'other');
const toInfusion = (r) => ({ id: r.id, agentId: r.agent_id, courseId: r.course_id || null, route: r.route || null, agentName: r.agent_name, agentShort: r.agent_short, date: r.date, time: r.time, doseValue: r.dose_value != null ? Number(r.dose_value) : null, doseUnit: r.dose_unit, durationMin: r.duration_min, place: r.place, notes: r.notes, reaction: r.reaction, createdAt: r.created_at });

export async function listAgents(userId) {
  await ensureSeedAgents(userId);
  const r = await pool.query(
    `select a.*, (select count(*) from infusion_sessions i where i.agent_id = a.id) as count, (select max(date)::text from infusion_sessions i where i.agent_id = a.id) as last_date
       from infusion_agents a where a.user_id = $1 order by a.active desc, a.sort_order, a.name`, [userId]);
  return r.rows.map(toAgent);
}
export async function createAgent(userId, a) {
  const r = await pool.query('insert into infusion_agents (user_id, name, short_name, default_dose, dose_unit, route, notes, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
    [userId, a.name, a.shortName || null, a.defaultDose ?? null, a.doseUnit || null, a.route || ROUTE_IV_DRIP, a.notes || null, a.sortOrder ?? 100]);
  return toAgent(r.rows[0]);
}
export async function updateAgent(userId, id, a) {
  const cols = { name: 'name', shortName: 'short_name', defaultDose: 'default_dose', doseUnit: 'dose_unit', route: 'route', notes: 'notes', active: 'active', sortOrder: 'sort_order' };
  const sets = []; const vals = [userId, id];
  for (const [k, col] of Object.entries(cols)) if (k in a && a[k] !== undefined) { vals.push(a[k]); sets.push(`${col} = $${vals.length}`); }
  if (!sets.length) { const r0 = await pool.query('select * from infusion_agents where user_id = $1 and id = $2', [userId, id]); return r0.rows[0] ? toAgent(r0.rows[0]) : null; }
  const r = await pool.query(`update infusion_agents set ${sets.join(', ')} where user_id = $1 and id = $2 returning *`, vals);
  return r.rows[0] ? toAgent(r.rows[0]) : null;
}
export async function deleteAgent(userId, id) {
  const used = (await pool.query('select count(*)::int as n from infusion_sessions where agent_id = $1', [id])).rows[0].n;
  if (used > 0) { const e = new Error('agent in use'); e.code = 'in_use'; e.count = used; throw e; }
  const r = await pool.query('delete from infusion_agents where user_id = $1 and id = $2', [userId, id]);
  return r.rowCount > 0;
}

export async function listInfusions(userId, { from, to, limit = 200 } = {}) {
  const params = [userId]; const where = ['i.user_id = $1'];
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (from && DAY.test(from)) { params.push(from); where.push(`i.date >= $${params.length}::date`); }
  if (to && DAY.test(to)) { params.push(to); where.push(`i.date <= $${params.length}::date`); }
  params.push(limit);
  const r = await pool.query(
    `select i.*, i.date::text as date, a.name as agent_name, a.short_name as agent_short from infusion_sessions i join infusion_agents a on a.id = i.agent_id
      where ${where.join(' and ')} order by i.date desc, i.time desc nulls last, i.created_at desc limit $${params.length}`, params);
  return r.rows.map(toInfusion);
}

function eventTitle(agent, x, language) {
  const what = `${agent.short_name || agent.name}${x.dose_value != null ? ` ${Number(x.dose_value)} ${x.dose_unit || agent.dose_unit || ''}` : ''}`;
  return t(language, `feedTitles.${routeKind(x.route || agent.route)}`, { what }).trim();
}
const reactionNote = (reaction, language) => (reaction ? t(language, 'feedTitles.reaction', { reaction }) : null);
export async function createInfusion(userId, x, tz = DEFAULT_TZ) {
  const ag = (await pool.query('select * from infusion_agents where user_id = $1 and id = $2', [userId, x.agentId])).rows[0];
  if (!ag) { const e = new Error('agent not found'); e.code = 'agent_not_found'; throw e; }
  const dose = x.doseValue ?? ag.default_dose; const unit = x.doseUnit || ag.dose_unit; const route = x.route || ag.route || null;
  // A session joins the given course, or the active course of this agent when there is exactly one.
  let courseId = x.courseId || null;
  if (!courseId && x.courseId !== null) {
    const ac = await pool.query(`select id from infusion_courses where user_id = $1 and agent_id = $2 and status = 'active' order by start_date desc`, [userId, ag.id]);
    if (ac.rows.length === 1) courseId = ac.rows[0].id;
  }
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const evId = await addEvent(client, userId, { type: 'INFUSION', date: x.date, time: x.time || '12:00', tz, title: eventTitle(ag, { dose_value: dose, dose_unit: unit, route }, language), notes: [route, x.place, x.notes, reactionNote(x.reaction, language)].filter(Boolean).join(' · ') || null, meta: { agent: ag.short_name || ag.name, agentId: ag.id, dose, unit, courseId, route }, source: 'infusions' });
    const r = await client.query(
      `insert into infusion_sessions (user_id, agent_id, event_id, date, time, dose_value, dose_unit, duration_min, place, notes, reaction, course_id, route) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *, date::text as date`,
      [userId, x.agentId, evId, x.date, x.time || null, dose, unit, x.durationMin ?? null, x.place || null, x.notes || null, x.reaction || null, courseId, route]);
    if (courseId) await closeCourseIfComplete(client, userId, courseId);
    const alertsRaised = await ivcSafetyAlerts(client, userId, ag, language);
    return { ...toInfusion({ ...r.rows[0], agent_name: ag.name, agent_short: ag.short_name }), alertsRaised };
  });
}

const IVC_RX = /ivc|витамин\s*c|аскорбин/i;
/** High-dose vitamin C without a G6PD result in MedControl: haemolysis risk in G6PD deficiency. One alert, ever (dedup). */
async function ivcSafetyAlerts(client, userId, agent, language) {
  if (!IVC_RX.test(`${agent.short_name || ''} ${agent.name || ''}`)) return 0;
  const g = await client.query(`select 1 from lab_results r join lab_tests t on t.id = r.test_id where r.user_id = $1 and t.canonical_key = 'G6PD' limit 1`, [userId]);
  if (g.rows.length) return 0;
  return raiseAlerts(client, userId, [{
    scope: 'INFUSION', key: 'IVC_G6PD', severity: 'YELLOW', dedup: 'infusion:ivc_g6pd',
    message: t(language, 'alertTexts.ivcG6pd'),
    context: { href: '/labs/upload' },
  }]);
}

/** Course status follows its counter: done when the plan is reached, active again if a session was removed or moved away. */
async function closeCourseIfComplete(client, userId, courseId) {
  if (!courseId) return;
  await client.query(`update infusion_courses c set status = case when (select count(*) from infusion_sessions s where s.course_id = c.id) >= c.planned_count then 'done' else 'active' end, updated_at = now()
     where c.user_id = $1 and c.id = $2 and c.status in ('active', 'done') and c.planned_count is not null`, [userId, courseId]);
}

// ---- courses: planned series of sessions with a cadence and a counter ----
const toCourse = (r) => ({ id: r.id, agentId: r.agent_id, agentName: r.agent_name, agentShort: r.agent_short, title: r.title, plannedCount: r.planned_count, cadenceDays: r.cadence_days, startDate: r.start_date, status: r.status, remind: r.remind, notes: r.notes,
  done: Number(r.done || 0), lastDate: r.last_date || null, nextDue: r.status === 'active' && r.cadence_days ? (r.last_date ? addDays(r.last_date, r.cadence_days) : r.start_date) : null });
const COURSE_SQL = `select c.*, c.start_date::text as start_date, a.name as agent_name, a.short_name as agent_short,
   (select count(*)::int from infusion_sessions s where s.course_id = c.id) as done,
   (select max(s.date)::text from infusion_sessions s where s.course_id = c.id) as last_date
   from infusion_courses c join infusion_agents a on a.id = c.agent_id`;
export async function listCourses(userId) {
  const r = await pool.query(`${COURSE_SQL} where c.user_id = $1 order by (c.status = 'active') desc, c.start_date desc`, [userId]);
  return r.rows.map(toCourse);
}
export async function createCourse(userId, c) {
  const ag = (await pool.query('select id from infusion_agents where user_id = $1 and id = $2', [userId, c.agentId])).rows[0];
  if (!ag) { const e = new Error('agent not found'); e.code = 'agent_not_found'; throw e; }
  const r = await pool.query('insert into infusion_courses (user_id, agent_id, title, planned_count, cadence_days, start_date, remind, notes) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
    [userId, c.agentId, c.title || null, c.plannedCount ?? null, c.cadenceDays ?? null, c.startDate, c.remind ?? true, c.notes || null]);
  return (await listCourses(userId)).find((x) => x.id === r.rows[0].id);
}
export async function updateCourse(userId, id, c) {
  const cols = { agentId: 'agent_id', title: 'title', plannedCount: 'planned_count', cadenceDays: 'cadence_days', startDate: 'start_date', status: 'status', remind: 'remind', notes: 'notes' };
  const sets = ['updated_at = now()']; const vals = [userId, id];
  for (const [k, col] of Object.entries(cols)) if (k in c && c[k] !== undefined) { vals.push(c[k]); sets.push(`${col} = $${vals.length}`); }
  const updated = await transaction(async (client) => {
    const r = await client.query(`update infusion_courses set ${sets.join(', ')} where user_id = $1 and id = $2 returning id`, vals);
    if (!r.rows.length) return false;
    if ('plannedCount' in c && !c.status) await closeCourseIfComplete(client, userId, id);
    return true;
  });
  if (!updated) return null;
  return (await listCourses(userId)).find((x) => x.id === id) || null;
}
export async function deleteCourse(userId, id) {
  const r = await pool.query('delete from infusion_courses where user_id = $1 and id = $2', [userId, id]);
  return r.rowCount > 0;
}
/** Active courses with a cadence that are due (for the scheduler). */
export async function dueCourses(userId, today) {
  const r = await pool.query(`${COURSE_SQL} where c.user_id = $1 and c.status = 'active' and c.remind and coalesce(c.cadence_days, 0) > 0`, [userId]);
  return r.rows.map(toCourse).filter((c) => c.nextDue && c.nextDue <= today);
}
export async function updateInfusion(userId, id, x, tz = DEFAULT_TZ) {
  const cur = (await pool.query('select * from infusion_sessions where user_id = $1 and id = $2', [userId, id])).rows[0];
  if (!cur) return null;
  const agentId = x.agentId || cur.agent_id;
  const ag = (await pool.query('select * from infusion_agents where user_id = $1 and id = $2', [userId, agentId])).rows[0];
  if (!ag) { const e = new Error('agent not found'); e.code = 'agent_not_found'; throw e; }
  const courseId = x.courseId === undefined ? cur.course_id : x.courseId;
  const route = x.route === undefined ? (cur.route || ag.route || null) : x.route;
  const next = { route, date: x.date ?? cur.date, time: x.time === undefined ? cur.time : x.time, dose_value: x.doseValue === undefined ? cur.dose_value : x.doseValue, dose_unit: x.doseUnit === undefined ? cur.dose_unit : x.doseUnit,
    duration_min: x.durationMin === undefined ? cur.duration_min : x.durationMin, place: x.place === undefined ? cur.place : x.place, notes: x.notes === undefined ? cur.notes : x.notes, reaction: x.reaction === undefined ? cur.reaction : x.reaction };
  const language = await userLanguage(userId);
  return transaction(async (client) => {
    const r = await client.query(
      `update infusion_sessions set agent_id=$3, date=$4, time=$5, dose_value=$6, dose_unit=$7, duration_min=$8, place=$9, notes=$10, reaction=$11, course_id=$12, route=$13, updated_at=now() where user_id=$1 and id=$2 returning *, date::text as date`,
      [userId, id, agentId, next.date, next.time, next.dose_value, next.dose_unit, next.duration_min, next.place, next.notes, next.reaction, courseId, route]);
    if (courseId) await closeCourseIfComplete(client, userId, courseId);
    if (cur.course_id && cur.course_id !== courseId) await closeCourseIfComplete(client, userId, cur.course_id);
    if (cur.event_id) await updateEvent(client, userId, cur.event_id, { type: 'INFUSION', date: next.date, time: next.time || '12:00', tz, title: eventTitle(ag, next, language), notes: [route, next.place, next.notes, reactionNote(next.reaction, language)].filter(Boolean).join(' · ') || null, meta: { agent: ag.short_name || ag.name, agentId: ag.id, dose: next.dose_value, unit: next.dose_unit, route, courseId } });
    return toInfusion({ ...r.rows[0], agent_name: ag.name, agent_short: ag.short_name });
  });
}
export async function deleteInfusion(userId, id) {
  const r = await pool.query('delete from infusion_sessions where user_id = $1 and id = $2 returning event_id, course_id', [userId, id]);
  if (!r.rows.length) return false;
  if (r.rows[0].event_id) await deleteEvent(pool, userId, r.rows[0].event_id);
  await closeCourseIfComplete(pool, userId, r.rows[0].course_id);
  return true;
}

/** Short summary for the AI profile and the report: per agent, count and last date within a window. */
export async function infusionSummary(userId, sinceDate) {
  const r = await pool.query(
    `select a.short_name, a.name, a.route, count(*)::int as n, max(i.date)::text as last, min(i.date)::text as first, string_agg(distinct coalesce(i.dose_value::text || ' ' || coalesce(i.dose_unit, ''), ''), ', ') as doses
       from infusion_sessions i join infusion_agents a on a.id = i.agent_id where i.user_id = $1 and i.date >= $2::date group by a.id, a.short_name, a.name, a.route order by n desc`, [userId, sinceDate]);
  return r.rows;
}
