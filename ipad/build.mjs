// Builds the spike's web part: the gateway as one browser module (web/dist/gateway.js) plus PGlite and pdf.js assets.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import stdlibDirs from 'node-stdlib-browser';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'web/dist');
const GW_MODULES = path.join(ROOT, 'gateway/node_modules');
const shim = (f) => path.join(HERE, 'web/shims', f);
const own = createRequire(import.meta.url);
// node-stdlib-browser lists package folders; esbuild wants the entry file
const stdlib = Object.fromEntries(Object.entries(stdlibDirs).map(([k, v]) => [k, v ? own.resolve(v) : null]));

const OWN = {
  crypto: shim('crypto.js'), fs: shim('fs-cjs.cjs'), 'fs/promises': shim('fs-promises.js'), os: shim('os.js'), url: shim('url.js'),
  module: shim('module.js'), async_hooks: shim('async_hooks.js'), diagnostics_channel: shim('diagnostics_channel.js'),
  'stream/promises': shim('stream-promises.js'),
  http: shim('http.js'),
  tls: shim('stub.js'), net: shim('stub.js'), dns: shim('stub.js'), readline: shim('stub.js'), child_process: shim('stub.js'),
  worker_threads: shim('stub.js'), http2: shim('stub.js'), perf_hooks: shim('perf_hooks.js'), v8: shim('stub.js'), inspector: shim('stub.js'),
  cluster: shim('stub.js'), 'util/types': stdlib.util,
};
const PKG_STUBS = { pg: shim('stub.js'), undici: shim('stub.js') };

function appFiles() {
  const out = {};
  const add = (abs) => { out[`/app/${path.relative(ROOT, abs)}`] = fs.readFileSync(abs, 'utf8'); };
  const walk = (dir, re) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, re); else if (re.test(e.name)) add(p); } };
  walk(path.join(ROOT, 'db/migrations'), /\.sql$/);
  walk(path.join(ROOT, 'locales'), /\.json$/);
  add(path.join(ROOT, 'gateway/package.json'));
  // binary files as base64 (the fs shim decodes the «base64:» prefix): report fonts and pdfkit's standard font metrics
  const bin = (abs, at) => { out[at] = `base64:${fs.readFileSync(abs).toString('base64')}`; };
  for (const f of fs.readdirSync(path.join(ROOT, 'gateway/fonts'))) if (f.endsWith('.ttf')) bin(path.join(ROOT, 'gateway/fonts', f), `/app/gateway/fonts/${f}`);
  for (const f of fs.readdirSync(path.join(ROOT, 'gateway/src/assets'))) bin(path.join(ROOT, 'gateway/src/assets', f), `/app/gateway/src/assets/${f}`);
  const pdfkitData = path.join(GW_MODULES, 'pdfkit/js/data');
  for (const f of fs.readdirSync(pdfkitData)) bin(path.join(pdfkitData, f), `/pdfkit/data/${f}`);
  return out;
}

// A patch that no longer matches must fail the build: a silent no-op here means a PDF parse that
// never finishes on the device after a dependency upgrade.
const patch = (src, from, to, what) => {
  if (!src.includes(from)) throw new Error(`build patch «${what}» no longer matches the dependency source; update the patch`);
  return src.replaceAll(from, to);
};

const nodePlugin = {
  name: 'node-builtins',
  setup(b) {
    b.onResolve({ filter: /^virtual:app-files$/ }, () => ({ path: 'app-files', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: `export default ${JSON.stringify(appFiles())};`, loader: 'js' }));
    b.onResolve({ filter: /^(node:)?[a-z0-9_/]+$/ }, (a) => {
      const name = a.path.replace(/^node:/, '');
      if (PKG_STUBS[name]) return { path: PKG_STUBS[name] };
      if (OWN[name]) return { path: OWN[name] };
      if (a.path.startsWith('node:') || (name in stdlib && !fs.existsSync(path.join(GW_MODULES, name)))) {
        const p = stdlib[name];
        return p ? { path: p } : { path: shim('stub.js') };
      }
      return undefined;
    });
    // pdfkit reads its font metrics from __dirname/data: point it at the copy in the virtual tree
    b.onLoad({ filter: /pdfkit[\\/]js[\\/]pdfkit\.es\.js$/ }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8').replaceAll('__dirname', '"/pdfkit"'), loader: 'js' }));
    // A module Worker in WKWebView on a device can be created and then never answer, so PDF parsing
    // never finishes. The fake worker runs the same code on the main thread. Font files are loaded
    // with fetch: the address is tauri://, which pdf.js treats as not a fetch URL and then waits on
    // XMLHttpRequest forever. A dynamic import of an image decoder never finishes here either.
    b.onLoad({ filter: /pdfjs-dist[\\/]legacy[\\/]build[\\/]pdf\.mjs$/ }, (a) => {
      let src = fs.readFileSync(a.path, 'utf8');
      src = patch(src, 'static #isWorkerDisabled = false;', 'static #isWorkerDisabled = true;', 'pdf.js fake worker');
      src = patch(src, 'return /https?:/.test(res?.protocol ?? "");', 'return /https?:|tauri:|asset:/.test(res?.protocol ?? "");', 'pdf.js fetch protocols');
      src = patch(src, 'return response.bytes();', 'return new Uint8Array(await response.arrayBuffer());', 'pdf.js response bytes');
      return { contents: src, loader: 'js' };
    });
    b.onLoad({ filter: /pdfjs-dist[\\/]legacy[\\/]build[\\/]pdf\.worker\.mjs$/ }, (a) => ({
      contents: patch(fs.readFileSync(a.path, 'utf8'),
        `async #getJsModule(fallbackCallback) {
    let instance = null;
    try {
      const mod = await import(
      /*webpackIgnore: true*/
      /*@vite-ignore*/
      \`\${WasmImage.#wasmUrl}\${this._noWasmFilename}\`);
      instance = mod.default();
    } catch (ex) {
      warn(\`#getJsModule: \${ex}\`);
    }
    fallbackCallback(instance);
  }`,
        `async #getJsModule(fallbackCallback) {
    fallbackCallback(null);
  }`, 'pdf.js worker image decoder'),
      loader: 'js',
    }));
    // Repository sources locate files next to themselves with import.meta.url: give them their path in the virtual tree.
    b.onLoad({ filter: /\.(m?js)$/ }, (a) => {
      if (a.path.includes('node_modules') || !a.path.startsWith(ROOT) || a.path.startsWith(path.join(HERE, 'node_modules'))) return undefined;
      const src = fs.readFileSync(a.path, 'utf8');
      if (!src.includes('import.meta.url')) return undefined;
      return { contents: src.replaceAll('import.meta.url', JSON.stringify(`file:///app/${path.relative(ROOT, a.path)}`)), loader: 'js', resolveDir: path.dirname(a.path) };
    });
  },
};

// only our own files: the static interface (build-frontend.mjs) lives in the same folder
for (const f of ['gateway.js', 'assets']) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets/pdfjs'), { recursive: true });
const result = await esbuild.build({
  entryPoints: [path.join(HERE, 'web/gateway-entry.js')],
  outfile: path.join(OUT, 'gateway.js'),
  bundle: true, format: 'esm', platform: 'browser', target: ['safari16'], mainFields: ['browser', 'module', 'main'],
  nodePaths: [GW_MODULES, path.join(HERE, 'node_modules')],
  inject: [own.resolve('node-stdlib-browser/helpers/esbuild/shim')],
  define: { global: 'globalThis' },
  plugins: [nodePlugin],
  logLevel: 'warning', metafile: true, minify: false, sourcemap: false,
});
const pglite = path.join(GW_MODULES, '@electric-sql/pglite/dist');
for (const f of ['pglite.wasm', 'pglite.data', 'initdb.wasm', 'pgcrypto.tar.gz']) fs.copyFileSync(path.join(pglite, f), path.join(OUT, f));
const pdfjs = path.join(GW_MODULES, 'pdfjs-dist');
fs.copyFileSync(path.join(pdfjs, 'legacy/build/pdf.worker.mjs'), path.join(OUT, 'assets/pdfjs/pdf.worker.mjs'));
fs.copyFileSync(path.join(pdfjs, 'package.json'), path.join(OUT, 'assets/pdfjs/package.json'));
fs.cpSync(path.join(pdfjs, 'standard_fonts'), path.join(OUT, 'assets/pdfjs/standard_fonts'), { recursive: true });
// The spike harness and its fixture are dev artifacts: MC_RELEASE=1 keeps them out of the app bundle
// (the harness can run the first-run wizard with a known password).
if (process.env.MC_RELEASE !== '1') {
  fs.copyFileSync(path.join(HERE, 'web/index.html'), path.join(OUT, 'spike.html'));
  // the synthetic report from the parser tests (made-up values) for the upload button
  fs.copyFileSync(path.join(ROOT, 'ingestion/tests/fixtures/pdf/rows.pdf'), path.join(OUT, 'rows.pdf'));
} else {
  for (const f of ['spike.html', 'rows.pdf']) fs.rmSync(path.join(OUT, f), { force: true });
}
const ocrDir = path.join(OUT, 'ocr');
fs.mkdirSync(ocrDir, { recursive: true });
fs.copyFileSync(path.join(GW_MODULES, 'tesseract.js/dist/worker.min.js'), path.join(ocrDir, 'worker.min.js'));
fs.copyFileSync(path.join(GW_MODULES, 'tesseract.js-core/tesseract-core-lstm.wasm.js'), path.join(ocrDir, 'tesseract-core-lstm.wasm.js'));
for (const code of ['rus', 'eng']) {
  fs.copyFileSync(path.join(GW_MODULES, `@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`), path.join(ocrDir, `${code}.traineddata.gz`));
}
const kb = Math.round(fs.statSync(path.join(OUT, 'gateway.js')).size / 1024);
console.log(`gateway.js ${kb} KB, ${Object.keys(result.metafile.inputs).length} modules`);
