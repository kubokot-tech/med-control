/**
 * Text recognition (OCR) of scans and photos on this machine: Tesseract compiled to WebAssembly (tesseract.js) with the
 * Russian and English models shipped as npm packages, so nothing is downloaded and nothing leaves the computer.
 * Used where the AI service cannot see images (DeepSeek, YandexGPT, GigaChat, a local model) or there is no AI at all.
 *
 * A scanned PDF is one picture per page: pdf.js decodes the largest image of each page (no canvas needed) and it goes
 * to Tesseract as a PNM bitmap. PDFs drawn with vector outlines instead of a picture are not recognised.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { lib as pdfjsLib } from './pdfText.js';
import { t } from './i18n.js';

const require = createRequire(import.meta.url);
const LANGS = ['rus', 'eng'];
const MIN_TEXT_CHARS = 80;

/** Both ingestion engines mark page boundaries in plain-text responses. */
export function pdfLayers(result) {
  if (Array.isArray(result.pages)) return result.pages;
  const marked = [...String(result.text || '').matchAll(/<!-- страница (\d+) -->\n([\s\S]*?)(?=<!-- страница \d+ -->|$)/g)];
  if (!marked.length) return null;
  const pages = Array(result.pages || Number(marked.at(-1)[1])).fill('');
  for (const [, n, text] of marked) if (Number(n) > 0 && Number(n) <= pages.length) pages[Number(n) - 1] = text.trim();
  return pages;
}
export function needsPageOcr(result) {
  const layers = pdfLayers(result);
  return layers ? !layers.length || layers.some((s) => s.trim().length < MIN_TEXT_CHARS)
    : (result.chars ?? result.text?.length ?? 0) < MIN_TEXT_CHARS * (result.pages || 1);
}

let langDir;
/**
 * tesseract.js reads all languages from one folder (and cannot take them as buffers: its initialize() joins the
 * buffers instead of the codes), while each model lives in its own package: link them into one temp folder once.
 */
function languageFolder() {
  if (langDir && fs.existsSync(langDir)) return langDir;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medcontrol-ocr-'));
  for (const code of LANGS) {
    const src = path.join(path.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0_best_int', `${code}.traineddata.gz`);
    fs.symlinkSync(src, path.join(dir, `${code}.traineddata.gz`));
  }
  langDir = dir;
  return dir;
}

/** A decoded pdf.js image ({ width, height, kind, data }) as a PNM file Tesseract can read. */
export function toPnm({ width: w, height: h, kind, data }) {
  if (kind === 1) { // 1 bit per pixel, rows padded to whole bytes, a set bit is white
    const out = Buffer.alloc(w * h);
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = data[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
    return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), out]);
  }
  const step = kind === 3 ? 4 : 3; // RGBA or RGB
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += step) {
    out[i * 3] = data[j]; out[i * 3 + 1] = data[j + 1]; out[i * 3 + 2] = data[j + 2];
  }
  return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), out]);
}

// Decode one page at a time; long documents never hold all of their scan bitmaps in memory.
async function* pageImages(buf, { layers = [], maxPages = Infinity } = {}) {
  const { getDocument, OPS } = await pdfjsLib();
  const task = getDocument({ data: new Uint8Array(buf), isEvalSupported: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      if (layers[n - 1]?.trim().length >= MIN_TEXT_CHARS) { yield null; continue; }
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      let best = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        let img = null;
        if (ops.fnArray[i] === OPS.paintImageXObject) {
          const name = ops.argsArray[i][0];
          const store = name.startsWith('g_') ? page.commonObjs : page.objs;
          img = await new Promise((resolve) => store.get(name, resolve));
        } else if (ops.fnArray[i] === OPS.paintInlineImageXObject) img = ops.argsArray[i][0];
        if (img?.data && (!best || img.width * img.height > best.width * best.height)) best = img;
      }
      yield best ? toPnm(best) : null;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}

export async function pdfPageImages(buf, options) {
  const out = [];
  for await (const image of pageImages(buf, options)) out.push(image);
  return out;
}

let queue = Promise.resolve();
/** One recognition at a time: each holds a worker with ~100 MB of models and keeps a core busy. */
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const limit = (p, ms, on, onTimeout) => {
  if (!on) return p;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(Object.assign(new Error('recognition timed out'), { code: 'ocr_failed' })); }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

/** Recognise a list of images (Buffers of PNG/JPEG/WebP/PNM; null for a page without a picture): text per image. */
export function recognize(images) {
  return serial(async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    // The iPad build sets this: the worker and the language files are in the app, not on a CDN, and a blob
    // worker cannot load them. Absent here, the desktop and the server keep the temp folder of the npm models.
    const local = globalThis.__MC_OCR;
    const opts = local
      ? { langPath: local.langPath, workerPath: local.workerPath, corePath: local.corePath, cacheMethod: 'none', gzip: true, workerBlobURL: false }
      : { langPath: languageFolder(), cacheMethod: 'none', gzip: true };
    let worker;
    let creationTimedOut = false;
    try {
      const creating = createWorker(LANGS, OEM.LSTM_ONLY, opts);
      // A worker that arrives after the timeout must not stay alive (~100 MB of models): the next call
      // would create another one, and repeated timeouts would exhaust the WebView's memory.
      creating.then((w) => { if (creationTimedOut) w.terminate().catch(() => {}); }, () => {});
      worker = await limit(creating, 45000, local, () => { creationTimedOut = true; });
      const texts = [];
      for await (const img of images) texts.push(img ? (await limit(worker.recognize(img), 60000, local)).data.text.trim() : '');
      return texts;
    } finally {
      if (worker) {
        // Node awaits terminate as before (a stray timer would hold the test process); the iPad gives it
        // a ceiling so a stuck worker cannot hang the recognition queue forever.
        if (local) await Promise.race([worker.terminate(), new Promise((resolve) => setTimeout(resolve, 5000))]).catch(() => {});
        else await worker.terminate().catch(() => {});
      }
    }
  });
}

/**
 * Text of a scanned PDF or a photo: { text, pages, chars }. Pages are marked like pdfPlainText() does, so the rest of
 * the code reads both the same way. Throws { code: 'ocr_failed' } when the file cannot be decoded.
 */
export async function ocrFile({ mimeType, data, layers = [], language }) {
  const images = mimeType === 'application/pdf' ? pageImages(data, { layers }) : [Buffer.from(data)];
  const recognized = await recognize(images).catch((e) => { throw Object.assign(new Error(`recognition failed: ${e?.message || e}`), { code: 'ocr_failed' }); });
  const pages = recognized.map((text, i) => {
    const original = layers[i]?.trim() || '';
    if (!original || text.includes(original)) return text;
    if (!text || original.includes(text)) return original;
    return `${original}\n${text}`;
  });
  const missing = pages.filter((text) => !text).length;
  const text = pages.length === 1 ? pages[0] : pages.map((s, i) => (s ? `<!-- страница ${i + 1} -->\n${s}` : null)).filter(Boolean).join('\n\n');
  const warning = text && missing ? '\n\n' + t(language, 'aiContext.unreadPages', { count: missing, total: pages.length }) : '';
  return { text: text + warning, pages: pages.length, chars: pages.reduce((n, s) => n + s.length, 0), unreadPages: missing };
}
