/**
 * The table of built-in reference ranges for docs/REFERENCE-RANGES.md (test/referenceRanges.test.js checks the doc
 * matches). After changing lib/referenceRanges.js: node src/tools/refsTable.js and paste between the refs markers.
 */
import { pathToFileURL } from 'node:url';
import { REFERENCE_RANGES } from '../lib/referenceRanges.js';
import { CATALOG_SEED } from '../lib/catalogSeed.js';

const num = (x) => String(x).replace('.', ',');
const range = (p) => (!p ? '' : p[0] != null && p[1] != null ? `${num(p[0])}–${num(p[1])}` : p[1] != null ? `≤ ${num(p[1])}` : `≥ ${num(p[0])}`);

export function refsTableMarkdown() {
  const head = ['| Показатель | Ключ | Единица | Любой пол | Женщины | Мужчины |', '|---|---|---|---|---|---|'];
  const rows = CATALOG_SEED.map((c) => {
    const r = REFERENCE_RANGES[c.key];
    const cells = r ? [range(r.any) || '—', range(r.f) || '—', range(r.m) || '—'] : ['из бланка', '', ''];
    return `| ${c.short || c.name} | \`${c.key}\` | ${c.unit || '—'} | ${cells.join(' | ')} |`;
  });
  return [...head, ...rows].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(refsTableMarkdown());
