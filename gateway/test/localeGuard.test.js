import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// docs/I18N.md: dates and numbers go through shared/format.js, never a hard-coded locale: in the interface (useFormat())
// and in the gateway (userFormat() for texts a person reads, aiFormat.js for texts for the model).
const ROOT = fileURLToPath(new URL('../../frontend/app/', import.meta.url));
const RX = /'ru-RU'|toLocale(Date|Time)?String\(|new Intl\.(DateTimeFormat|NumberFormat)\('(ru|en)/;

test('the interface formats dates and numbers only through useFormat()', () => {
  const bad = [];
  for (const f of readdirSync(ROOT, { recursive: true })) {
    if (!/\.tsx?$/.test(f)) continue;
    readFileSync(ROOT + f, 'utf8').split('\n').forEach((line, i) => { if (RX.test(line)) bad.push(`frontend/app/${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});

// lib/units.js formatValueText(): the text of a converted result stored in lab_results.value_text, data rather than display.
const GATEWAY = fileURLToPath(new URL('../src/', import.meta.url));
const GATEWAY_DATA = new Set(['lib/units.js']);
// en-US formatToParts in lib/dates.js and the scheduler is arithmetic on time zones, not text for a reader
const GATEWAY_RX = /'ru-RU'|toLocale(Date|Time)?String\(|new Intl\.(DateTimeFormat|NumberFormat)\('ru/;

test('the gateway formats dates and numbers only through userFormat() or aiFormat.js', () => {
  const bad = [];
  for (const f of readdirSync(GATEWAY, { recursive: true })) {
    if (!f.endsWith('.js') || GATEWAY_DATA.has(f.split('\\').join('/'))) continue;
    readFileSync(GATEWAY + f, 'utf8').split('\n').forEach((line, i) => { if (GATEWAY_RX.test(line)) bad.push(`gateway/src/${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});

