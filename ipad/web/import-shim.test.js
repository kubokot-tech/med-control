import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import Module from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '../../gateway/package.json'));

// The iPad fs shim, bundled the same way the app bundles it, without the gateway around it.
async function loadShim() {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'mc-shim-')), 'fs.cjs');
  await esbuild.build({
    absWorkingDir: HERE,
    entryPoints: ['./shims/fs-cjs.cjs'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    external: ['@tauri-apps/plugin-fs'],
    plugins: [{
      name: 'app-files',
      setup(b) {
        b.onResolve({ filter: /^virtual:app-files$/ }, () => ({ path: 'app-files', namespace: 'virtual' }));
        b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
      },
    }],
  });
  return require(out);
}

function zip(files) {
  const archiver = require('archiver');
  const a = archiver('zip', { zlib: { level: 0 } });
  const chunks = [];
  a.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => { a.on('end', res); a.on('error', rej); });
  for (const [name, value] of Object.entries(files)) a.append(Buffer.isBuffer(value) ? value : JSON.stringify(value), { name });
  a.finalize();
  return done.then(() => Buffer.concat(chunks));
}

test('an empty iPad install can read a fictional archive through the ranged file shim', async () => {
  const shim = await loadShim();
  const realFs = require('fs');
  const patched = {};
  for (const key of Object.getOwnPropertyNames(realFs)) {
    const desc = Object.getOwnPropertyDescriptor(realFs, key);
    if (desc) Object.defineProperty(patched, key, desc);
  }
  patched.createReadStream = (p, opts) => shim.createReadStream(p, opts);
  patched.ReadStream = shim.ReadStream;
  patched.stat = shim.stat;
  patched.statSync = shim.statSync;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent?.filename || '';
    if ((request === 'fs' || request === 'node:fs') && from.includes(`${path.sep}graceful-fs${path.sep}`)) return patched;
    return origLoad.call(this, request, parent, isMain);
  };
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}graceful-fs${path.sep}`) || key.includes(`${path.sep}unzipper${path.sep}`)) delete require.cache[key];
  }
  const unzipper = require('unzipper');
  Module._load = origLoad;

  const note = 'Вымышленная заметка. Самочувствие обычное, к врачу не обращались.';
  const events = [{ id: 1, user_id: '00000000-0000-0000-0000-000000000001', kind: 'note', title: 'Контрольная запись', at: '2026-04-14' }];
  const padding = Buffer.alloc(64 * 1024, 7);
  const bytes = await zip({
    'manifest.json': { app: 'medcontrol', madeUp: true },
    'tables/events.json': events,
    'tables/notes.json': [{ id: 1, body: note }],
    'files/notes/padding.bin': padding,
  });
  assert.ok(bytes.length > padding.length, 'the central directory sits after the file bytes');

  shim.mkdirSync('/data/import', { recursive: true });
  shim.writeFileSync('/data/import/all.zip', bytes);

  const dir = await unzipper.Open.file('/data/import/all.zip');
  const names = dir.files.map((f) => f.path).sort();
  assert.deepEqual(names, ['files/notes/padding.bin', 'manifest.json', 'tables/events.json', 'tables/notes.json']);
  const gotEvents = JSON.parse((await dir.files.find((f) => f.path === 'tables/events.json').buffer()).toString('utf8'));
  assert.equal(gotEvents[0].title, 'Контрольная запись');
  const gotNote = JSON.parse((await dir.files.find((f) => f.path === 'tables/notes.json').buffer()).toString('utf8'));
  assert.equal(gotNote[0].body, note);
  const gotPad = await dir.files.find((f) => f.path === 'files/notes/padding.bin').buffer();
  assert.equal(gotPad.length, padding.length);
  assert.equal(gotPad[0], 7);
  assert.equal(gotPad[gotPad.length - 1], 7);
});
