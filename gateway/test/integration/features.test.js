import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => {
  if (SKIP) return;
  db = await setupDb('features');
  // these tests use the lenvatinib preset's infusion catalog (IVC) and rules; the default is the general lab control
  const p = await import('../../src/lib/protocol.js');
  await p.setProtocol(p.protocolFromPreset('lenvatinib'));
});
after(async () => { if (db) await db.teardown(); });

test('infusion course: sessions attach to the active course, counter closes it, IVC without G6PD raises one alert', { skip: SKIP }, async () => {
  const inf = await import('../../src/lib/infusions.js');
  const agents = await inf.listAgents(USER_ID);
  const ivc = agents.find((a) => a.shortName === 'IVC');
  const course = await inf.createCourse(USER_ID, { agentId: ivc.id, title: 'IVC осень', plannedCount: 2, cadenceDays: 3, startDate: '2026-03-01' });
  assert.equal(course.done, 0);
  assert.equal(course.nextDue, '2026-03-01');
  const s1 = await inf.createInfusion(USER_ID, { agentId: ivc.id, date: '2026-03-01' });
  assert.equal(s1.courseId, course.id, 'auto-attached to the only active course');
  assert.equal(s1.alertsRaised, 1);
  const s2 = await inf.createInfusion(USER_ID, { agentId: ivc.id, date: '2026-03-04' });
  assert.equal(s2.alertsRaised, 0, 'alert is raised once');
  const after1 = (await inf.listCourses(USER_ID))[0];
  assert.equal(after1.done, 2);
  assert.equal(after1.status, 'done', 'planned count reached');
  const alerts = await db.pool.query(`select context->>'key' as key from alerts where user_id=$1`, [USER_ID]);
  assert.deepEqual(alerts.rows, [{ key: 'IVC_G6PD' }]);
  assert.deepEqual(await inf.dueCourses(USER_ID, '2026-03-10'), [], 'done courses are not due');
  const c2 = await inf.createCourse(USER_ID, { agentId: ivc.id, plannedCount: 10, cadenceDays: 7, startDate: '2026-03-08' });
  assert.equal((await inf.dueCourses(USER_ID, '2026-03-07')).length, 0);
  assert.equal((await inf.dueCourses(USER_ID, '2026-03-08'))[0].id, c2.id);
});

test('scheduler reminds about a due course on the day and then every third day', { skip: SKIP }, async () => {
  const { startScheduler } = await import('../../src/lib/scheduler.js');
  const sent = [];
  const at = (d) => startScheduler({ pool: db.pool, userId: USER_ID, log: db.quiet, intervalMs: 3_600_000, now: () => new Date(`${d}T10:05:00+03:00`), readyImpl: () => true, sendImpl: async (text) => { sent.push(text); } });
  for (const d of ['2026-03-08', '2026-03-09', '2026-03-11', '2026-03-11']) { const s = at(d); await s.tick(); s(); }
  const course = sent.filter((t) => /Курс/.test(t));
  assert.equal(course.length, 2, 'day 0 and day 3, deduped within a day');
  assert.match(course[0], /сделано 0 из 10, следующее введение по плану сегодня/);
});

test('anamnesis versions: change creates a version, diff against current, restore', { skip: SKIP }, async () => {
  const a = await import('../../src/lib/anamnesis.js');
  const { getSetting } = await import('../../src/lib/settings.js');
  const v1 = await a.saveAnamnesis(USER_ID, 'Диагноз: пример.\nЛенватиниб 24 мг.', { source: 'manual' });
  assert.equal(v1.versioned, true);
  const same = await a.saveAnamnesis(USER_ID, 'Диагноз: пример.\nЛенватиниб 24 мг.');
  assert.equal(same.changed, false);
  const v2 = await a.saveAnamnesis(USER_ID, 'Диагноз: пример.\nЛенватиниб 20 мг.\nГипертония.', { source: 'ai_draft' });
  assert.equal(v2.versioned, true);
  const list = await a.listVersions(USER_ID);
  assert.deepEqual(list.map((v) => v.source), ['ai_draft', 'manual']);
  const old = await a.getVersion(USER_ID, list[1].id);
  assert.equal(old.isCurrent, false);
  assert.deepEqual(old.stats, { added: 2, removed: 1 });
  await a.restoreVersion(USER_ID, list[1].id);
  assert.equal(getSetting('anamnesis'), 'Диагноз: пример.\nЛенватиниб 24 мг.');
  assert.equal((await a.listVersions(USER_ID))[0].source, 'restore');
});

test('diary scales: extra scales live in jsonb, merge on partial updates, null removes; profile lists them', { skip: SKIP }, async () => {
  const { saveSymptoms } = await import('../../src/lib/symptoms.js');
  const { buildPatientProfile, invalidateProfileCache } = await import('../../src/lib/patientProfile.js');
  const { todayKey, addDays } = await import('../../src/lib/dates.js');
  const day = addDays(todayKey('Europe/Moscow'), -1);
  const a = await saveSymptoms(USER_ID, day, { edema: 2, dyspnea: 1, fatigue: 1 });
  assert.equal(a.entry.edema, 2);
  assert.equal(a.entry.fatigue, 1);
  const b = await saveSymptoms(USER_ID, day, { itch: 3 });
  assert.deepEqual([b.entry.edema, b.entry.dyspnea, b.entry.itch, b.entry.fatigue], [2, 1, 3, 1], 'a partial update keeps the other scales');
  const c = await saveSymptoms(USER_ID, day, { dyspnea: null });
  assert.equal(c.entry.dyspnea, null);
  const row = (await db.pool.query('select scales, fatigue from symptom_entries where user_id = $1 and date = $2', [USER_ID, day])).rows[0];
  assert.deepEqual(row.scales, { edema: 2, itch: 3 });
  assert.equal(row.fatigue, 1, 'historic scales stay in their columns');
  const ev = await db.pool.query(`select title from events where user_id = $1 and type = 'SYMPTOM' order by occurred_at desc limit 1`, [USER_ID]);
  assert.match(ev.rows[0].title, /отёки 2/);
  invalidateProfileCache();
  assert.match(await buildPatientProfile(USER_ID), /отёки \(0–3\) 2/);
});

test('extending a completed infusion course makes its next session due', { skip: SKIP }, async () => {
  const { createAgent, createCourse, createInfusion, updateCourse, dueCourses } = await import('../../src/lib/infusions.js');
  const agent = await createAgent(USER_ID, { name: 'Synthetic extension test' });
  const course = await createCourse(USER_ID, { agentId: agent.id, startDate: '2026-02-11', plannedCount: 1, cadenceDays: 3 });
  await createInfusion(USER_ID, { agentId: agent.id, courseId: course.id, date: '2026-02-11' });
  const extended = await updateCourse(USER_ID, course.id, { plannedCount: 2 });
  assert.equal(extended.status, 'active');
  assert.equal(extended.nextDue, '2026-02-14');
  assert.ok((await dueCourses(USER_ID, '2026-02-14')).some((row) => row.id === course.id));
});
