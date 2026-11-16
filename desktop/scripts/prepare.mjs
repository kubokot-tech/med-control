#!/usr/bin/env node
/**
 * Prepares what the Tauri bundle carries (docs/DESKTOP.md, step 3):
 *   src-tauri/binaries/node-<target>[.exe]  the Node runtime, the sidecar (externalBin)
 *   build/app/gateway                       gateway sources + production node_modules (with PGlite, without native canvas)
 *   build/app/shared, build/app/locales, build/app/db/migrations
 *   build/app/frontend                      the Next standalone server + .next/static + public + launcher
 * The layout repeats the repository (gateway/ next to shared/ and locales/), as the Docker images do: the code uses ../shared and ../locales.
 *
 *   node scripts/prepare.mjs [--target aarch64-apple-darwin|x86_64-apple-darwin|x86_64-pc-windows-msvc] [--skip-frontend]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node for the app; the Docker images use the same major line. Checked against SHASUMS256.txt from nodejs.org.
const NODE_VERSION = '22.23.4';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DESKTOP, '..');
const BUILD = path.join(DESKTOP, 'build');
const APP = path.join(BUILD, 'app');
const CACHE = path.join(BUILD, 'cache');
const BINARIES = path.join(DESKTOP, 'src-tauri', 'binaries');

const TARGETS = {
  'aarch64-apple-darwin': { dist: 'darwin-arm64', ext: 'tar.gz', bin: 'bin/node' },
  'x86_64-apple-darwin': { dist: 'darwin-x64', ext: 'tar.gz', bin: 'bin/node' },
  'x86_64-pc-windows-msvc': { dist: 'win-x64', ext: 'zip', bin: 'node.exe' },
};

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const target = opt('--target') || hostTarget();
const skipFrontend = args.includes('--skip-frontend');
if (!TARGETS[target]) fail(`unknown target ${target}; one of ${Object.keys(TARGETS).join(', ')}`);

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

function hostTarget() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  return `${process.arch}-${process.platform}`;
}
function fail(msg) { console.error(`prepare: ${msg}`); process.exit(1); }
function step(msg) { console.log(`prepare: ${msg}`); }
function run(cmd, argv, cwd, env = {}) {
  execFileSync(cmd, argv, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: isWin && cmd.endsWith('.cmd') });
}
function copy(from, to) { fs.cpSync(from, to, { recursive: true, dereference: true }); }
function fresh(dir) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }

async function download(url, file) {
  if (fs.existsSync(file)) return;
  step(`download ${url}`);
  const r = await fetch(url);
  if (!r.ok) fail(`${url}: HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
}

async function nodeBinary() {
  const t = TARGETS[target];
  const name = `node-v${NODE_VERSION}-${t.dist}`;
  const archive = path.join(CACHE, `${name}.${t.ext}`);
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  await download(`${base}/${name}.${t.ext}`, archive);
  await download(`${base}/SHASUMS256.txt`, path.join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`));
  const sums = fs.readFileSync(path.join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`), 'utf8');
  const want = sums.split('\n').find((l) => l.endsWith(`  ${name}.${t.ext}`))?.split(' ')[0];
  const got = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (!want || want !== got) { fs.rmSync(archive); fail(`checksum mismatch for ${name}.${t.ext}`); }

  const out = path.join(CACHE, name);
  fresh(out);
  // bsdtar (macOS, Windows 10+) reads both .tar.gz and .zip
  run('tar', ['-xf', archive, '-C', out, `${name}/${t.bin}`, `${name}/LICENSE`], DESKTOP);
  fs.mkdirSync(BINARIES, { recursive: true });
  const dest = path.join(BINARIES, `node-${target}${t.ext === 'zip' ? '.exe' : ''}`);
  fs.copyFileSync(path.join(out, name, t.bin), dest);
  fs.chmodSync(dest, 0o755);
  // Node's own third-party licenses travel with the app (THIRD-PARTY-NOTICES.md)
  fs.mkdirSync(APP, { recursive: true });
  fs.copyFileSync(path.join(out, name, 'LICENSE'), path.join(APP, 'NODE-LICENSE.txt'));
  step(`node ${NODE_VERSION} → ${path.relative(DESKTOP, dest)}`);
}

function gateway() {
  const dir = path.join(APP, 'gateway');
  fresh(dir);
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, 'gateway', f), path.join(dir, f));
  copy(path.join(ROOT, 'gateway', 'src'), path.join(dir, 'src'));
  copy(path.join(ROOT, 'gateway', 'fonts'), path.join(dir, 'fonts'));
  // Optional dependencies stay: PGlite is one. pdf.js's native canvas (@napi-rs) is dropped, as --omit=optional does
  // in the Dockerfile: pdf.js only reads text here.
  run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], dir);
  fs.rmSync(path.join(dir, 'node_modules', '@napi-rs'), { recursive: true, force: true });
  if (!fs.existsSync(path.join(dir, 'node_modules', '@electric-sql', 'pglite'))) fail('PGlite is missing in gateway/node_modules');
  copy(path.join(ROOT, 'shared'), path.join(APP, 'shared'));
  copy(path.join(ROOT, 'locales'), path.join(APP, 'locales'));
  fresh(path.join(APP, 'db'));
  copy(path.join(ROOT, 'db', 'migrations'), path.join(APP, 'db', 'migrations'));
  step('gateway, shared, locales, db/migrations staged');
}

function frontend() {
  const src = path.join(ROOT, 'frontend');
  if (!skipFrontend) run(npm, ['run', 'build'], src, { NEXT_TELEMETRY_DISABLED: '1' });
  const standalone = path.join(src, '.next', 'standalone');
  if (!fs.existsSync(path.join(standalone, 'server.js'))) fail('no Next standalone build (frontend/.next/standalone/server.js)');
  const dir = path.join(APP, 'frontend');
  fresh(dir);
  copy(standalone, dir);
  // Next brings sharp (a native image library) as an optional dependency for its image optimizer; the optimizer is
  // off (next.config: images.unoptimized), so the library never loads and must not travel in the bundle.
  for (const p of ['sharp', '@img']) fs.rmSync(path.join(dir, 'node_modules', p), { recursive: true, force: true });
  copy(path.join(src, '.next', 'static'), path.join(dir, '.next', 'static'));
  copy(path.join(src, 'public'), path.join(dir, 'public'));
  fs.copyFileSync(path.join(DESKTOP, 'scripts', 'next-launcher.cjs'), path.join(dir, 'desktop-launcher.cjs'));
  step('frontend staged');
}

/** Source maps and type declarations are not needed at run time (about a third of node_modules). */
function prune() {
  const junk = /\.(map|d\.ts|d\.cts|d\.mts)$/;
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (junk.test(e.name)) { fs.rmSync(p); n++; }
    }
  };
  walk(APP);
  step(`pruned ${n} source maps and type files`);
}

/** The bundle must run on any machine of the target: no compiled Node addons. */
function noNativeModules() {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.node')) found.push(path.relative(APP, p));
    }
  };
  walk(APP);
  if (found.length) fail(`native modules in the bundle:\n  ${found.join('\n  ')}`);
}

fs.mkdirSync(APP, { recursive: true });
await nodeBinary();
gateway();
frontend();
prune();
noNativeModules();
step(`done for ${target}`);
