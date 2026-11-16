import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitSummary, fmtDateLong } from '../src/lib/telegramText.js';

const app = 'https://dtc.example';

test('summary for a new document with flags', () => {
  const t = commitSummary({ already: false, labName: 'МКНЦ', docDate: '2026-02-03', inserted: 24, documentId: 'd1', alertsRaised: 1,
    flagged: [{ name: 'АЛТ', value: 122.2, unit: 'ЕД/л', dir: 'high' }, { name: 'Гемоглобин', value: 110, unit: 'г/л', dir: 'low' }] }, app);
  assert.match(t, /✅ Загружено: МКНЦ, 3 февраля 2026\./);
  assert.match(t, /24 показателя, вне нормы 2:/);
  assert.match(t, /↑ АЛТ 122\.2 ЕД\/л/);
  assert.match(t, /↓ Гемоглобин 110 г\/л/);
  assert.match(t, /⚠️ Тревог: 1/);
  assert.match(t, /https:\/\/dtc\.example\/labs\/documents\/d1$/);
});

test('summary when all normal, plural forms', () => {
  assert.match(commitSummary({ already: false, inserted: 1, flagged: [], alertsRaised: 0, documentId: 'x' }, app), /1 показатель, все в норме/);
  assert.match(commitSummary({ already: false, inserted: 5, flagged: [], alertsRaised: 0, documentId: 'x' }, app), /5 показателей, все в норме/);
});

test('duplicate', () => {
  const t = commitSummary({ already: true, labName: 'Helix', docDate: '2026-01-10', inserted: 0, flagged: [], documentId: 'd2' }, app);
  assert.match(t, /уже есть в МедКонтроле \(Helix, 10 января 2026\)/);
});

test('html escaped', () => {
  const t = commitSummary({ already: false, labName: 'A<b>', inserted: 0, flagged: [], documentId: 'x' }, app);
  assert.match(t, /A&lt;b&gt;/);
});

test('fmtDateLong', () => {
  assert.equal(fmtDateLong('2026-09-08'), '8 сентября 2026');
  assert.equal(fmtDateLong(null), '');
});
