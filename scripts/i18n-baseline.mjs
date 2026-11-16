#!/usr/bin/env node
/**
 * Lines with Cyrillic in the interface code, per file: what is still to move into the dictionaries (docs/I18N.md).
 * gateway/test/i18n.test.js checks that no file has more than frontend/i18n-baseline.json allows, so the number only
 * goes down. After moving a screen's texts to locales/, write the new numbers:
 *   node scripts/i18n-baseline.mjs > frontend/i18n-baseline.json
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'app');
const CYRILLIC = /[А-Яа-яЁё]/;

/** { 'ui/MainNav.tsx': 3, … } for every .ts/.tsx under frontend/app except the dictionaries' own folder. */
export function cyrillicLines() {
  const out = {};
  for (const f of readdirSync(APP, { recursive: true }).map(String).sort()) {
    if (!/\.tsx?$/.test(f) || f.startsWith(`i18n${path.sep}`)) continue;
    const n = readFileSync(path.join(APP, f), 'utf8').split('\n').filter((l) => CYRILLIC.test(l)).length;
    if (n) out[f.split(path.sep).join('/')] = n;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const counts = cyrillicLines();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  process.stdout.write(`${JSON.stringify({ total, files: counts }, null, 2)}\n`);
}
