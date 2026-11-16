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

const require = createRequire(import.meta.url);
const LANGS = ['rus', 'eng'];
export const OCR_MAX_PAGES = 20;

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

/** The largest picture of each page (a scan is one picture per page), at most maxPages pages: [Buffer | null]. */
export async function pdfPageImages(buf, { maxPages = OCR_MAX_PAGES } = {}) {
  const { getDocument, OPS } = await pdfjsLib();
  const task = getDocument({ data: new Uint8Array(buf), isEvalSupported: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const out = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
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
      out.push(best ? toPnm(best) : null);
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}

let queue = Promise.resolve();
/** One recognition at a time: each holds a worker with ~100 MB of models and keeps a core busy. */
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Recognise a list of images (Buffers of PNG/JPEG/WebP/PNM; null for a page without a picture): text per image. */
export function recognize(images) {
  return serial(async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker(LANGS, OEM.LSTM_ONLY, { langPath: languageFolder(), cacheMethod: 'none', gzip: true });
    try {
      const texts = [];
      for (const img of images) texts.push(img ? (await worker.recognize(img)).data.text.trim() : '');
      return texts;
    } finally {
      await worker.terminate();
    }
  });
}

/**
 * Text of a scanned PDF or a photo: { text, pages, chars }. Pages are marked like pdfPlainText() does, so the rest of
 * the code reads both the same way. Throws { code: 'ocr_failed' } when the file cannot be decoded.
 */
export async function ocrFile({ mimeType, data }) {
  let images;
  try {
    images = mimeType === 'application/pdf' ? await pdfPageImages(data) : [Buffer.from(data)];
  } catch (e) {
    throw Object.assign(new Error(`cannot read the file for recognition: ${e.message}`), { code: 'ocr_failed' });
  }
  const pages = await recognize(images).catch((e) => { throw Object.assign(new Error(`recognition failed: ${e?.message || e}`), { code: 'ocr_failed' }); });
  const text = pages.length === 1 ? pages[0] : pages.map((t, i) => (t ? `<!-- страница ${i + 1} -->\n${t}` : null)).filter(Boolean).join('\n\n');
  return { text, pages: pages.length, chars: pages.reduce((n, t) => n + t.length, 0) };
}
