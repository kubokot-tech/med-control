// Static export of the real interface, built from a patched copy of frontend/ (the source stays as it is):
// no server language detection (the page applies the cookie or the browser language itself; NEXT_PUBLIC_STATIC_EXPORT),
// no /api/gateway route (mc-fetch.js answers it in the page), dynamic segments with one placeholder page.
// Output: web/dist (next to gateway.js), the spike page moves to spike.html.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.build');
const FE = path.join(TMP, 'frontend');
const OUT = path.join(HERE, 'web/dist');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const skip = new Set(['node_modules', '.next', 'out', 'tsconfig.tsbuildinfo']);
fs.cpSync(path.join(ROOT, 'frontend'), FE, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
for (const d of ['shared', 'locales']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
fs.symlinkSync(fs.realpathSync(path.join(ROOT, 'frontend/node_modules')), path.join(FE, 'node_modules'));

const edit = (rel, fn) => { const p = path.join(FE, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
// A patch that no longer matches must fail the build, not pass silently (same rule as build.mjs).
const must = (src, needle, what) => {
  const ok = needle instanceof RegExp ? needle.test(src) : src.includes(needle);
  if (!ok) throw new Error(`build patch «${what}» no longer matches the frontend source; update the patch`);
  return src;
};
fs.writeFileSync(path.join(FE, 'next.config.mjs'), `export default {
  output: 'export', poweredByHeader: false,
  images: { unoptimized: true }, experimental: { externalDir: true },
};\n`);
edit('app/i18n/server.ts', (s) => must(s, /export async function serverLanguage\(\)[^]*?\n}\n/, 'serverLanguage').replace(/export async function serverLanguage\(\)[^]*?\n}\n/, `export async function serverLanguage(): Promise<Language> {\n  return pickLanguage(undefined, null);\n}\n`).replace("import { cookies, headers } from 'next/headers';\n", ''));
fs.rmSync(path.join(FE, 'app/api'), { recursive: true });
for (const p of ['app/labs/series/page.tsx', 'app/labs/series-raw/page.tsx', 'app/labs/summary/page.tsx']) edit(p, (s) => must(s, "export const dynamic = 'force-dynamic';\n", `${p} force-dynamic`).replace("export const dynamic = 'force-dynamic';\n", ''));
edit('app/labs/documents/[id]/page.tsx', (s) => must(s, "export const dynamic = 'force-dynamic';\n", 'documents force-dynamic').replace("export const dynamic = 'force-dynamic';\n", "export const dynamicParams = false;\nexport function generateStaticParams() { return [{ id: '_' }]; }\n"));
fs.renameSync(path.join(FE, 'app/notes/[id]/page.tsx'), path.join(FE, 'app/notes/[id]/NoteClient.tsx'));
fs.writeFileSync(path.join(FE, 'app/notes/[id]/page.tsx'), "import { Suspense } from 'react';\nimport NoteClient from './NoteClient';\nexport const dynamicParams = false;\nexport function generateStaticParams() { return [{ id: '_' }]; }\nexport default function Page() { return <Suspense><NoteClient /></Suspense>; }\n");

execFileSync('npx', ['next', 'build'], { cwd: FE, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', DTC_EDITION: 'ipad', NEXT_PUBLIC_STATIC_EXPORT: '1' } });

const exported = path.join(FE, 'out');
const keep = new Set(['gateway.js', 'pglite.wasm', 'pglite.data', 'initdb.wasm', 'pgcrypto.tar.gz', 'assets', 'rows.pdf', 'mc-notify.js', 'mc-words.js', 'ocr', 'locales']);
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
if (process.env.MC_RELEASE !== '1') fs.copyFileSync(path.join(HERE, 'web/index.html'), path.join(OUT, 'spike.html'));
else fs.rmSync(path.join(OUT, 'spike.html'), { force: true });
fs.cpSync(exported, OUT, { recursive: true });
fs.copyFileSync(path.join(HERE, 'web/mc-fetch.js'), path.join(OUT, 'mc-fetch.js'));
fs.copyFileSync(path.join(HERE, 'web/mc-notify.js'), path.join(OUT, 'mc-notify.js'));
fs.copyFileSync(path.join(HERE, 'web/mc-words.js'), path.join(OUT, 'mc-words.js'));
// The plain page scripts read their texts from these copies of locales/<lang>/ipad.json.
fs.mkdirSync(path.join(OUT, 'locales'), { recursive: true });
for (const lang of ['ru', 'en']) fs.copyFileSync(path.join(ROOT, 'locales', lang, 'ipad.json'), path.join(OUT, 'locales', `${lang}.json`));
let pages = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) { fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('<head>', '<head><script src="/mc-words.js"></script><script src="/mc-fetch.js"></script><script src="/mc-notify.js"></script>')); pages++; } } };
walk(OUT);
console.log(`static interface: ${pages} pages in ${OUT}`);
