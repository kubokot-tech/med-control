#!/usr/bin/env node
/**
 * THIRD-PARTY-NOTICES.md: production dependencies of the gateway, the frontend, the desktop shell and the iPad app
 * with their licenses, read from the installed node_modules (run `npm ci` in each first). Re-run before a release:
 *   node scripts/third-party.mjs > THIRD-PARTY-NOTICES.md
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
// packages that do not state a license in package.json, checked by hand
// packages whose package.json license is not the license of what they carry
const OVERRIDE = { '@tesseract.js-data/eng': 'Apache-2.0 (данные tessdata)', '@tesseract.js-data/rus': 'Apache-2.0 (данные tessdata)' };
const KNOWN = { 'png-js': 'MIT (LICENSE в пакете)', buffers: 'MIT/X11 (по репозиторию автора, substack/node-buffers)' };

/** Production dependency closure of one package folder, from its package-lock.json. */
function prodPackages(dir) {
  const lockPath = path.join(ROOT, dir, 'package-lock.json');
  if (!existsSync(lockPath)) return [];
  const lock = read(lockPath);
  const out = new Map();
  for (const [p, meta] of Object.entries(lock.packages || {})) {
    if (!p.startsWith('node_modules/') || meta.dev) continue; // optional packages ship too (sharp, canvas, PGlite, platform binaries)
    const name = p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
    let license = meta.license;
    const pj = path.join(ROOT, dir, p, 'package.json');
    if (!license && existsSync(pj)) { const j = read(pj); license = typeof j.license === 'string' ? j.license : j.license?.type || (j.licenses || []).map((l) => l.type).join(' OR '); }
    out.set(`${name}@${meta.version}`, { name, version: meta.version, license: OVERRIDE[name] || license || KNOWN[name] || 'UNKNOWN' });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const lines = ['# Сторонние компоненты', '',
  'МедКонтроль распространяется по AGPL-3.0 (LICENSE). Ниже — сторонние компоненты, которые входят в сборку, и их лицензии.',
  'Файл собирается скриптом `node scripts/third-party.mjs > THIRD-PARTY-NOTICES.md` из установленных зависимостей.', '',
  '## Шрифты', '',
  '- Source Sans 3 (Adobe), Literata (The Literata Project Authors) — интерфейс, `frontend/public/fonts`; Inter (The Inter Project Authors) — PDF-отчёты, `gateway/fonts`. SIL Open Font License 1.1, текст и авторские права: `frontend/public/fonts/OFL.txt`, `gateway/fonts/OFL.txt`.',
  '- Стандартные шрифты pdf.js (`pdfjs-dist/standard_fonts`): лицензии FoxIt и Liberation приложены в самом пакете.', ''];
for (const [dir, title] of [['gateway', 'Сервер (gateway)'], ['frontend', 'Интерфейс (frontend)'], ['desktop', 'Настольное приложение (desktop)'], ['ipad', 'Приложение iPad (ipad)']]) {
  const pkgs = prodPackages(dir);
  if (!pkgs.length) continue;
  const byLicense = new Map();
  for (const p of pkgs) byLicense.set(p.license, (byLicense.get(p.license) || 0) + 1);
  lines.push(`## ${title}`, '', `Пакетов: ${pkgs.length}. По лицензиям: ${[...byLicense].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} — ${n}`).join(', ')}.`, '',
    '| Пакет | Версия | Лицензия |', '|---|---|---|', ...pkgs.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`), '');
}
lines.push('## Настольное приложение (desktop)', '',
  '- Tauri 2 и крейты Rust (`desktop/src-tauri/Cargo.lock`): в основном MIT и Apache-2.0; полный список для релиза собирать `cargo about generate` в папке `desktop/src-tauri`.',
  '- Встроенный Node.js: MIT; лицензии его собственных сторонних компонентов — файл `LICENSE` дистрибутива Node, кладётся рядом с бинарником.',
  '- PGlite (`@electric-sql/pglite`, необязательная зависимость gateway, входит только в настольную сборку): Apache-2.0 и PostgreSQL License.', '',
  '## Приложение iPad (ipad)', '',
  '- Tauri 2 и крейты Rust (`ipad/src-tauri/Cargo.lock`, включая objc2 и objc2-local-authentication для Face ID): в основном MIT и Apache-2.0; полный список для релиза собирать `cargo about generate` в папке `ipad/src-tauri`.',
  '- PGlite и pdf.js входят из зависимостей gateway (см. выше); модели распознавания tesseract.js (`rus`, `eng`) — Apache-2.0 (данные tessdata).', '');
const py = existsSync(path.join(ROOT, 'ingestion', 'requirements.txt')) ? readFileSync(path.join(ROOT, 'ingestion', 'requirements.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-')) : [];
const PY_LICENSES = { fastapi: 'MIT', uvicorn: 'BSD-3-Clause', pydantic: 'MIT', 'python-multipart': 'Apache-2.0', pypdf: 'BSD-3-Clause' };
lines.push('', '## Сервис разбора PDF на Python (ingestion, необязательный)', '', '| Пакет | Версия | Лицензия |', '|---|---|---|',
  ...py.map((l) => { const [name, version] = l.split('=='); const base = name.replace(/\[.*\]$/, ''); return `| ${name} | ${version || ''} | ${PY_LICENSES[base] || 'см. PyPI'} |`; }), '',
  '## Алгоритмы', '',
  '- `gateway/src/lib/pdfText.js` повторяет алгоритм извлечения текста из pypdf (BSD-3-Clause, Copyright © 2006-2008 Mathieu Fenniak и авторы pypdf).', '');
console.log(lines.join('\n'));
