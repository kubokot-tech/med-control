import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO } from '../src/tools/demoTexts.js';

const shape = (v) => (Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => k !== 'tags').map((k) => [k, shape(v[k])])) : typeof v);

test('the demo patient has the same shape in every language', () => {
  assert.deepEqual(shape(DEMO.en), shape(DEMO.ru));
});

test('the English demo has no Russian in it', () => {
  assert.doesNotMatch(JSON.stringify(DEMO.en), /[А-Яа-яЁё]/);
});
