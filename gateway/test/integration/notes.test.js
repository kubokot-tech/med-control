import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

let db;
before(async () => { if (!SKIP) { db = await setupDb('notes'); await seedRegimen(db.pool); } });
after(async () => { if (db) await db.teardown(); });

test('notes: create, import, search by tag, feed event, delete', { skip: SKIP }, async () => {
  const n = await import('../../src/lib/notes.js');
  const a = await n.createNote(USER_ID, { title: 'Протоны при опухоли', body: '# Заголовок\n\nТекст про **лучевую**.', tags: ['Протоны', '#лучевая'], url: 'https://example.org' });
  assert.deepEqual(a.tags, ['протоны', 'лучевая']);
  const imp = n.parseMarkdownImport('---\ntitle: Ответ ChatGPT\ntags: протоны, терапия\nsource: ChatGPT\n---\nТело.', 'chat.md');
  const b = await n.createNote(USER_ID, imp, { source: 'import', sourceName: imp.sourceName });
  assert.equal(b.source, 'import');
  const byTag = await n.listNotes(USER_ID, { tag: 'протоны' });
  assert.equal(byTag.length, 2);
  assert.equal((await n.listNotes(USER_ID, { q: 'лучев' })).length, 1);
  assert.deepEqual((await n.listTags(USER_ID)).map((t) => t.tag), ['протоны', 'лучевая', 'терапия']);
  const ev = await db.pool.query(`select count(*)::int as c from events where user_id=$1 and type='NOTE' and source='notes'`, [USER_ID]);
  assert.equal(ev.rows[0].c, 2);
  await n.updateNote(USER_ID, a.id, { title: 'Протоны', pinned: true });
  assert.equal((await n.listNotes(USER_ID))[0].title, 'Протоны', 'pinned first');
  assert.equal(await n.deleteNote(USER_ID, b.id), true);
  const ev2 = await db.pool.query(`select count(*)::int as c from events where user_id=$1 and type='NOTE'`, [USER_ID]);
  assert.equal(ev2.rows[0].c, 1, 'feed event removed with the note');
});

test('dossier markdown has every section and the notes', { skip: SKIP }, async () => {
  const { buildDossierMarkdown } = await import('../../src/lib/dossierExport.js');
  const { saveSymptoms } = await import('../../src/lib/symptoms.js');
  await saveSymptoms(USER_ID, '2026-03-10', { bpSys: 135, bpDia: 85, fatigue: 2 });
  const md = await buildDossierMarkdown(USER_ID, { from: '2026-03-01', to: '2026-03-31' });
  for (const h of ['## 1. Анамнез', '## 2. Терапия', '## 3. Анализы', '## 4. Исследования', '## 5. Вехи', '## 6. Капельницы', '## 7. Дневник самочувствия (1', '## 8. Тревоги', '## 9. Приёмы', '## 10. Заметки пациента (1)', '### Протоны']) assert.ok(md.includes(h), h);
  assert.match(md, /\| 2026-03-10 \| +\| 135\/85 \|/);
  assert.match(md, /Ленватиниб 24 мг, ежедневно/);
  assert.ok(!(await buildDossierMarkdown(USER_ID, { withNotes: false })).includes('## 10.'));
});
