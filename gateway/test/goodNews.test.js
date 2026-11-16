import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x'; // goodNews.js imports the pool; the pure part needs none
const { goodNewsFrom } = await import('../src/lib/goodNews.js');

const today = '2026-11-03';

test('the latest positive milestone of the last 60 days; old, negative and AI reviews are not news', () => {
  const milestones = [
    { id: 'a', date: '2026-10-20', kind: 'imaging', tone: 'positive', title: 'КТ: частичный ответ' },
    { id: 'b', date: '2026-10-25', kind: 'consult', tone: 'negative', title: 'Пауза терапии' },
    { id: 'c', date: '2026-10-30', kind: 'ai_review', tone: 'positive', title: 'Оценка ИИ' },
    { id: 'd', date: '2026-06-01', kind: 'surgery', tone: 'positive', title: 'Операция' },
  ];
  assert.deepEqual(goodNewsFrom({ milestones, today }), [{ id: 'ms:a', kind: 'milestone', date: '2026-10-20', title: 'КТ: частичный ответ', milestoneId: 'a' }]);
});

test('a key marker back in range: latest within the reference, the one before outside it', () => {
  const labs = [
    { key: 'ALT', date: '2026-09-10', value: 138, refLow: null, refHigh: '40' },
    { key: 'ALT', date: '2026-10-27', value: 37, refLow: null, refHigh: '40' },
    { key: 'HGB', date: '2026-10-01', value: 124, refLow: '117', refHigh: '160' },
    { key: 'HGB', date: '2026-10-27', value: 126, refLow: '117', refHigh: '160' },
    { key: 'PLT', date: '2026-10-01', value: 140, refLow: '150', refHigh: '400' },
    { key: 'PLT', date: '2026-10-27', value: 145, refLow: '150', refHigh: '400' },
    { key: 'TSH', date: '2026-05-01', value: 9, refLow: '0.4', refHigh: '4' },
    { key: 'TSH', date: '2026-06-01', value: 2, refLow: '0.4', refHigh: '4' },
  ];
  const out = goodNewsFrom({ labs, today });
  assert.deepEqual(out.map((x) => [x.kind, x.key, x.date, x.was]), [['labNormal', 'ALT', '2026-10-27', 'high']], 'HGB was already normal, PLT is still low, TSH is too old');
});

test('newest first, at most three', () => {
  const milestones = [{ id: 'a', date: '2026-10-01', kind: 'imaging', tone: 'positive', title: 'КТ' }];
  const labs = ['ALT', 'AST', 'CREA', 'GLU'].flatMap((key, i) => [
    { key, date: '2026-09-01', value: 100, refLow: null, refHigh: '50' },
    { key, date: `2026-10-1${i}`, value: 10, refLow: null, refHigh: '50' },
  ]);
  const out = goodNewsFrom({ milestones, labs, today });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((x) => x.date), ['2026-10-13', '2026-10-12', '2026-10-11']);
});
