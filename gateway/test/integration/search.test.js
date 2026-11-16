import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('search'); });
after(async () => { if (db) await db.teardown(); });

test('russian stemming across notes, milestones and document texts; markers and medications by substring', { skip: SKIP }, async () => {
  const notes = await import('../../src/lib/notes.js');
  const { addEvent } = await import('../../src/lib/feed.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const { extractBySha } = await import('../../src/lib/extracts.js');
  await notes.createNote(USER_ID, { title: 'Протонная терапия', body: 'Статья про облучение опухоли протонами.' });
  const ev = await addEvent(db.pool, USER_ID, { type: 'MILESTONE', date: '2026-01-10', title: 'КТ: очаги в лёгких', meta: { kind: 'imaging', tone: 'neutral' }, source: 'test' });
  await db.pool.query(`insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,'2026-01-10','imaging','neutral','КТ: очаги в лёгких','Паратрахеальный лимфоузел 9 мм')`, [USER_ID, ev]);
  const a = await storeAttachment(db.pool, USER_ID, ev, Buffer.from('%PDF-1.4 x'), 'application/pdf', 'ct.pdf');
  await extractBySha(USER_ID, a.sha256, { mode: 'text', fetchImpl: async () => new Response(JSON.stringify({ pages: 1, chars: 500, text: 'Заключение: множественные очаги обоих лёгких без динамики.' }), { status: 200 }) });
  await db.pool.query(`insert into medications (user_id, name, role) values ($1, 'Левотироксин натрия', 'support')`, [USER_ID]);

  // the route is a plain handler over pool: call the SQL through a fake fastify app
  const routes = (await import('../../src/routes/search.js')).default;
  let handler; await routes({ get: (path, opts, h) => { handler = h; }, authenticate: () => {} });
  const run = async (q) => (await handler({ user: { sub: USER_ID }, query: { q } })).results;

  const r1 = await run('очаг');
  assert.ok(r1.some((x) => x.kind === 'milestone' && x.title.startsWith('КТ')), 'stemmed «очаги» in a milestone title');
  assert.ok(r1.some((x) => x.kind === 'document' && /\*\*очаги\*\*/.test(x.snippet)), 'document text highlighted');
  const r2 = await run('протон');
  assert.ok(r2.some((x) => x.kind === 'note'), 'note by stem');
  assert.ok((await run('паратрахеальн')).some((x) => x.kind === 'milestone'));
  const r3 = await run('левотир');
  assert.ok(r3.some((x) => x.kind === 'medication'));
  const r4 = await run('алт');
  assert.ok(r4.some((x) => x.kind === 'marker' && x.id === 'ALT'));
  assert.deepEqual(await run('x'), [], 'too short');
});
