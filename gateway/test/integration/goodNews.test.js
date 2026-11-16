import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('goodnews'); });
after(async () => { if (db) await db.teardown(); });

test('good news: a positive milestone and ALT back in range, from the database', { skip: SKIP }, async () => {
  const { commitManual } = await import('../../src/lib/labsCommit.js');
  const { goodNews } = await import('../../src/lib/goodNews.js');
  const { addEvent } = await import('../../src/lib/feed.js');
  const { todayKey, addDays } = await import('../../src/lib/dates.js');
  const tz = 'Europe/Moscow';
  const today = todayKey(tz);
  assert.deepEqual(await goodNews(USER_ID, tz), [], 'nothing yet');
  await commitManual(USER_ID, { date: addDays(today, -40), rows: [{ key: 'ALT', value: '150' }] }, { tz });
  await commitManual(USER_ID, { date: addDays(today, -5), rows: [{ key: 'ALT', value: '30' }] }, { tz });
  const day = addDays(today, -10);
  const eventId = await addEvent(db.pool, USER_ID, { type: 'MILESTONE', date: day, title: 'КТ', meta: { kind: 'imaging', tone: 'positive' }, source: 'test' });
  await db.pool.query(`insert into milestones (user_id, event_id, date, kind, tone, title) values ($1, $2, $3, 'imaging', 'positive', 'КТ: частичный ответ')`, [USER_ID, eventId, day]);
  const items = await goodNews(USER_ID, tz);
  assert.deepEqual(items.map((x) => [x.kind, x.key || x.title, x.date]), [['labNormal', 'ALT', addDays(today, -5)], ['milestone', 'КТ: частичный ответ', day]]);
});

test('home: bad news hides milestones and streaks until brought back; a new one hides them again', { skip: SKIP }, async () => {
  const { homeHuman, resumeFromQuiet } = await import('../../src/lib/homeHuman.js');
  const { savePatientCard } = await import('../../src/lib/patientCard.js');
  const { addEvent } = await import('../../src/lib/feed.js');
  const { todayKey, addDays } = await import('../../src/lib/dates.js');
  const tz = 'Europe/Moscow';
  const today = todayKey(tz);
  const milestone = async (date) => {
    const eventId = await addEvent(db.pool, USER_ID, { type: 'MILESTONE', date, title: 'КТ', meta: { kind: 'imaging', tone: 'negative' }, source: 'test' });
    await db.pool.query(`insert into milestones (user_id, event_id, date, kind, tone, title) values ($1, $2, $3, 'imaging', 'negative', 'КТ: прогрессия')`, [USER_ID, eventId, date]);
  };
  assert.equal((await homeHuman(USER_ID, tz)).quiet.on, false);
  await milestone(addDays(today, -3));
  const q = await homeHuman(USER_ID, tz);
  assert.equal(q.quiet.reason, 'badNews');
  assert.deepEqual(q.moments, []);
  assert.equal((await resumeFromQuiet(USER_ID, tz)).quiet.on, false);
  assert.equal((await homeHuman(USER_ID, tz)).quiet.on, false, 'remembered');
  await milestone(addDays(today, -1));
  assert.equal((await homeHuman(USER_ID, tz)).quiet.on, true, 'a newer one');
  await resumeFromQuiet(USER_ID, tz);
  await savePatientCard({ moments: false }, { today });
  assert.equal((await homeHuman(USER_ID, tz)).quiet.reason, 'setting');
  await savePatientCard({ moments: true }, { today });
});
