import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, yearsText } from '../src/lib/patientCard.js';

test('age in full years and its Russian word', () => {
  assert.equal(ageOn('1968-03-12', '2026-03-11'), 57);
  assert.equal(ageOn('1968-03-12', '2026-03-12'), 58);
  assert.equal(ageOn('', '2026-03-12'), null);
  assert.deepEqual([1, 3, 11, 21, 58, 104].map((n) => yearsText(n, 'ru')), ['1 год', '3 года', '11 лет', '21 год', '58 лет', '104 года']);
  assert.deepEqual([1, 58].map((n) => yearsText(n, 'en')), ['1 year', '58 years']);
});
