/**
 * Texts the gateway writes itself (docs/I18N.md). Dictionaries are the project's: locales/<language>/<section>.json,
 * shared with the interface, and locales/<language>/server/<section>.json, which the interface does not bundle.
 * A section name is unique across both folders. A key missing in a language falls back to Russian, the source language.
 *
 *   t(language, 'schedule.daily', { n: 2 })    an ICU message with its arguments
 *   raw(language, 'presets.base.rules.…')      the text as written: templates the gateway fills in itself
 *   relocalize(text, keys, language)           a message stored in another language, in this one
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_LANGUAGE, LANGUAGES, normalizeLanguage } from '../../../shared/format.js';

// gateway/src/lib → the repository root; the Docker image and the desktop bundle keep the same layout (/locales next to /shared)
const LOCALES = fileURLToPath(new URL('../../../locales/', import.meta.url));

const sections = new Map();
/** The parsed dictionary of a section, {} when there is none. */
function section(language, name) {
  const id = `${language}/${name}`;
  if (!sections.has(id)) {
    const file = [`${LOCALES}${language}/server/${name}.json`, `${LOCALES}${language}/${name}.json`].find(existsSync);
    sections.set(id, file ? JSON.parse(readFileSync(file, 'utf8')) : {});
  }
  return sections.get(id);
}

/** The string under 'section.a.b' in one language, undefined when it is not there. Keys may hold # % - (catalog keys). */
function lookup(language, key) {
  const [name, ...path] = key.split('.');
  let v = section(language, name);
  for (const k of path) v = v != null && typeof v === 'object' && Object.hasOwn(v, k) ? v[k] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** The text of a key as written, in the language or in Russian; the key itself when the text is nowhere. */
export function raw(language, key) {
  return lookup(normalizeLanguage(language), key) ?? lookup(DEFAULT_LANGUAGE, key) ?? key;
}

/** Is there a text under this key in the language or in Russian? */
export const has = (language, key) => (lookup(normalizeLanguage(language), key) ?? lookup(DEFAULT_LANGUAGE, key)) !== undefined;

const compiled = new Map();
/** An ICU message with its arguments. */
export function t(language, key, args) {
  const lang = normalizeLanguage(language);
  const text = raw(lang, key);
  const id = `${lang}\n${text}`;
  if (!compiled.has(id)) compiled.set(id, new IntlMessageFormat(text, lang, undefined, { ignoreTag: true }));
  return compiled.get(id).format(args);
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const templates = new Map();
/** The template of a key in one language as a regular expression: «{v} {u}» become named groups. Plain {arg} messages only. */
function templateRx(language, key) {
  const id = `${language}\n${key}`;
  if (!templates.has(id)) {
    const text = lookup(language, key);
    const parts = text == null ? null : text.split(/\{(\w+)\}/);
    templates.set(id, parts && new RegExp(`^${parts.map((p, i) => (i % 2 ? `(?<${p}>.*?)` : escapeRx(p))).join('')}$`, 's'));
  }
  return templates.get(id);
}

/**
 * Which of `keys` a text stored in another language is: { key, args } with the arguments as written, or null.
 * A text in `language` itself never matches, so what the reader's language wrote stays exactly as stored.
 */
export function matchMessage(text, keys, language) {
  const lang = normalizeLanguage(language);
  for (const other of LANGUAGES) {
    if (other === lang) continue;
    for (const key of keys) {
      const m = templateRx(other, key)?.exec(text);
      if (m) return { key, args: { ...m.groups } };
    }
  }
  return null;
}

/** `text` in `language` when it is one of the messages `keys` written in another language; `mapArgs` may adjust its arguments. */
export function relocalize(text, keys, language, mapArgs = (args) => args) {
  if (text == null) return text;
  const m = matchMessage(text, keys, language);
  return m ? t(language, m.key, mapArgs(m.args)) : text;
}
