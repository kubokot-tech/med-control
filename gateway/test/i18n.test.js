import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';
import { TYPE } from '@formatjs/icu-messageformat-parser';
import { cyrillicLines } from '../../scripts/i18n-baseline.mjs';

// docs/I18N.md: dictionaries in locales/<language>/<section>.json and, for texts only the gateway writes, in
// locales/<language>/server/<section>.json; ICU messages, the same keys in every language.
const LOCALES = fileURLToPath(new URL('../../locales/', import.meta.url));
const languages = readdirSync(LOCALES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const jsonIn = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
/** Interface sections, bundled into the frontend. */
const interfaceSections = (lang) => jsonIn(LOCALES + lang);
/** Every section: 'errors.json', 'server/markers.json'. */
const sections = (lang) => [...interfaceSections(lang), ...jsonIn(`${LOCALES}${lang}/server`).map((f) => `server/${f}`)];
const load = (lang, file) => JSON.parse(readFileSync(`${LOCALES}${lang}/${file}`, 'utf8'));

/**
 * Flat { 'nav.today': 'Сегодня' } of a nested dictionary. Keys: letters, digits and _, a dot separates levels. Server
 * dictionaries are keyed by what the data holds too, catalog keys and preset ids: NEUT#, NEUT%, U-PRO, kidney-transplant.
 */
function flatten(obj, prefix = '', keyRx = /^[A-Za-z0-9_]+$/) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    assert.match(k, keyRx, `key «${prefix}${k}»`);
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`, keyRx));
    else out[prefix + k] = v;
  }
  return out;
}

const SERVER_KEY = /^[A-Za-z0-9_#%-]+$/;
const flat = (lang, f) => flatten(load(lang, f), '', f.startsWith('server/') ? SERVER_KEY : undefined);

/** Names of the ICU arguments of a message, sorted: «{n, plural, …} {name}» → ['n', 'name']. */
function argumentsOf(message, lang) {
  const names = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type !== TYPE.literal && n.type !== TYPE.pound && n.value) names.add(n.value);
      if (n.options) for (const o of Object.values(n.options)) walk(o.value);
      if (n.children) walk(n.children);
    }
  };
  walk(new IntlMessageFormat(message, lang).getAst());
  return [...names].sort();
}

test('Russian is there and every language has the same sections and keys', () => {
  assert.ok(languages.includes('ru'));
  const ruKeys = Object.fromEntries(sections('ru').map((f) => [f, Object.keys(flat('ru', f)).sort()]));
  for (const lang of languages) {
    assert.deepEqual(sections(lang), sections('ru'), `${lang}: sections`);
    for (const f of sections('ru')) assert.deepEqual(Object.keys(flat(lang, f)).sort(), ruKeys[f], `${lang}/${f}: keys`);
  }
});

test('every message is valid ICU text with the same arguments in every language', () => {
  for (const f of sections('ru')) {
    const ru = flat('ru', f);
    for (const lang of languages) {
      const msgs = flat(lang, f);
      for (const [key, msg] of Object.entries(msgs)) {
        assert.ok(typeof msg === 'string' && msg.trim(), `${lang}/${f} ${key}: empty`);
        assert.deepEqual(argumentsOf(msg, lang), argumentsOf(ru[key], 'ru'), `${lang}/${f} ${key}: arguments`);
      }
    }
  }
});

test('the interface loads every interface section and no server one (frontend/app/i18n/messages.ts)', () => {
  const src = readFileSync(fileURLToPath(new URL('../../frontend/app/i18n/messages.ts', import.meta.url)), 'utf8');
  for (const f of interfaceSections('ru')) assert.match(src, new RegExp(`locales/ru/${f.replace('.', '\\.')}'`), f);
  assert.doesNotMatch(src, /locales\/\w+\/server\//);
});

test('a section name is unique across the interface and server folders (lib/i18n.js looks in both)', () => {
  const names = sections('ru').map((f) => f.replace(/^server\//, ''));
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('texts move out of the interface code, never back (frontend/i18n-baseline.json)', () => {
  const baseline = JSON.parse(readFileSync(fileURLToPath(new URL('../../frontend/i18n-baseline.json', import.meta.url)), 'utf8')).files;
  const grown = Object.entries(cyrillicLines()).filter(([f, n]) => n > (baseline[f] || 0)).map(([f, n]) => `frontend/app/${f}: ${n} lines with Cyrillic, allowed ${baseline[f] || 0}`);
  assert.deepEqual(grown, [], 'put new texts into locales/ru/*.json (useTranslations); after moving texts run: node scripts/i18n-baseline.mjs > frontend/i18n-baseline.json');
});
