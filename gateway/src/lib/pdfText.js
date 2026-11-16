/**
 * Text layer of a PDF with pdf.js, the way pypdf's extract_text() writes it: the lab parsers were written against
 * pypdf output (ingestion/tools/pdf_text.py), so the desktop edition, which has no Python, must give the same text.
 *
 * pypdf does not lay text out by position; it walks the content stream and decides on line breaks and spaces from how
 * the text matrix moves between operators (pypdf/_text_extraction: TextExtraction, crlf_space_check). Lab reports
 * depend on that: a table cell drawn in its own BT…ET block with «Tm 1 0 0 -1 0 0» jumps through the origin and lands
 * on a new line in pypdf even when it sits on the same baseline. So this module replays pypdf's algorithm on pdf.js's
 * operator list (fonts and ToUnicode already decoded by pdf.js) instead of guessing from glyph positions.
 *
 * What pdf.js does not expose is the font's width table; the space width pypdf takes from it is estimated from the
 * glyphs the page draws (the space glyph if any, otherwise half the average width, as pypdf does without a space).
 * Checked against pypdf on generated PDFs (test/pdfText.test.js); on real lab reports run src/tools/comparePdfText.js.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pdfjs;
/** pdf.js, loaded once (also used by ocr.js for the page images of scans). */
export async function lib() {
  if (!pdfjs) {
    // Without the optional native canvas pdf.js warns once at import that it cannot polyfill drawing APIs; text needs none.
    const warn = console.warn;
    console.warn = (...args) => { if (!/^Warning: Cannot (polyfill|load "@napi-rs\/canvas")/.test(String(args[0]))) warn(...args); };
    try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } finally { console.warn = warn; }
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  return pdfjs;
}
const STANDARD_FONTS = `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

const IDENTITY = [1, 0, 0, 1, 0, 0];
const PAGE_ORIENTATIONS = [0, 90, 180, 270];
const XFORM_ORIENTATIONS = [0, 90, 270, 360]; // sic: pypdf's extract_xform_text() default, 180 is not in it

const mult = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const orient = (m) => (m[3] > 1e-6 ? 0 : m[3] < -1e-6 ? 180 : m[1] > 0 ? 90 : 270);

/** Characters that keep the insertion order in pypdf's get_display_str(), and right-to-left ones. */
const keepsOrder = (c) => c <= 0x2f || (c >= 0x3a && c <= 0x40) || (c >= 0x2000 && c <= 0x206f) || (c >= 0x20a0 && c <= 0x21ff);
const isRtl = (c) => (c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);

/**
 * pypdf's TextExtraction for one content stream (a page or a form XObject), on normalized operators:
 * [op, args] with op one of BT ET q Q cm Tf Td TD Tm T* TL Tj TJ ' " Do and glyph runs [{ s, w }] (text, width in
 * 1/1000 of the font size). fonts: Map(fontKey → { halfSpace, space }) in the same units.
 */
export class PypdfText {
  constructor(fonts, orientations = PAGE_ORIENTATIONS) {
    this.fonts = fonts;
    this.orientations = orientations;
    this.cm = IDENTITY.slice(); this.tm = IDENTITY.slice();
    this.cmStack = [];
    this.cmPrev = IDENTITY.slice(); this.tmPrev = IDENTITY.slice();
    this.spaceWidth = 500; // pypdf's start value, set at the first Tf
    this.font = null;
    this.size = { strWidths: 0, spaceWidth: 0, strHeight: 0 };
    this.TL = 0; this.fontSize = 12;
    this.text = ''; this.output = ''; this.rtl = false;
  }

  flush() { this.output += this.text; this.text = ''; }

  /** crlf_space_check(): a new line when the matrix moved more than 0.8 of a line, a space when it moved past a space. */
  crlf(strWidths) {
    const mPrev = mult(this.tmPrev, this.cmPrev);
    const m = mult(this.tm, this.cm);
    const orientation = orient(m);
    if (!this.orientations.includes(orientation)) return; // OrientationNotFoundError: nothing updated
    const dx = m[4] - mPrev[4], dy = m[5] - mPrev[5];
    const scalePrevX = Math.hypot(this.tmPrev[0], this.tmPrev[1]);
    const scalePrevY = Math.hypot(this.tmPrev[2], this.tmPrev[3]);
    const scaleY = Math.hypot(this.tm[2], this.tm[3]);
    const [movedHeight, movedWidth] = orientation === 0 || orientation === 180 ? [dy, dx] : [dx, dy];
    const last = (this.output + this.text).slice(-1);
    const spaceWidth = this.size.spaceWidth / 1000;
    if (last !== '') { // pypdf: IndexError on empty output, swallowed
      if (Math.abs(movedHeight) > 0.8 * Math.min(this.size.strHeight * scalePrevY, this.fontSize * scaleY)) {
        if (last !== '\n') { this.output += `${this.text}\n`; this.text = ''; }
      } else if (movedWidth >= (spaceWidth + strWidths) * scalePrevX && last !== ' ') {
        this.text += ' ';
      }
    }
    this.tmPrev = this.tm.slice(); this.cmPrev = this.cm.slice();
  }

  /** Td/Tm/T* hand the width of the text shown since the last move to crlf(). */
  takeWidths() { const w = this.size.strWidths / 1000; this.size.strWidths = 0; return w; }

  tj(run) {
    const visible = this.orientations.includes(orient(mult(this.tm, this.cm)));
    let widths = 0;
    if (visible) {
      for (const g of run) {
        widths += g.w;
        for (const ch of g.s) {
          const c = ch.length === 1 ? ch.codePointAt(0) : 1;
          if (keepsOrder(c)) this.text = this.rtl ? ch + this.text : this.text + ch;
          else if (isRtl(c)) { if (!this.rtl) { this.rtl = true; this.text = ''; } this.text = ch + this.text; }
          else { if (this.rtl) { this.rtl = false; this.text = ''; } this.text += ch; }
        }
      }
    }
    this.size.strWidths += widths * this.fontSize;
    this.size.spaceWidth = this.spaceWidth * this.fontSize;
    this.size.strHeight = this.fontSize;
    this.crlf(0);
  }

  op(name, args) {
    switch (name) {
      case 'BT': this.tm = IDENTITY.slice(); this.flush(); break;
      case 'ET': this.flush(); break;
      case 'q': this.cmStack.push([this.cm, this.font, this.fontSize, this.spaceWidth, this.TL]); break;
      case 'Q': {
        const s = this.cmStack.pop();
        if (s) [this.cm, this.font, this.fontSize, this.spaceWidth, this.TL] = s; else this.cm = IDENTITY.slice();
        break;
      }
      case 'cm': this.flush(); this.cm = mult(args.map(Number), this.cm); break;
      case 'TL': this.TL = Number(args[0] || 0) * this.fontSize * Math.hypot(this.tm[0], this.tm[2]); break;
      case 'Tf': {
        this.flush();
        this.font = args[0];
        this.spaceWidth = this.fonts.get(args[0])?.halfSpace ?? 250;
        const size = Number(args[1]);
        if (Number.isFinite(size)) this.fontSize = size;
        break;
      }
      case 'Td': {
        const [tx, ty] = args.map(Number);
        this.tm[4] += tx * this.tm[0] + ty * this.tm[2];
        this.tm[5] += tx * this.tm[1] + ty * this.tm[3];
        this.crlf(this.takeWidths());
        break;
      }
      case 'TD': this.op('TL', [-Number(args[1])]); this.op('Td', args); break;
      case 'Tm': this.tm = args.slice(0, 6).map(Number); this.crlf(this.takeWidths()); break;
      case 'T*':
        this.tm[4] -= this.TL * this.tm[2];
        this.tm[5] -= this.TL * this.tm[3];
        this.crlf(this.takeWidths());
        break;
      case 'Tj': this.tj(args[0]); break;
      case 'TJ': {
        const confirm = this.spaceWidth * 0.95;
        for (const item of args[0]) {
          if (typeof item === 'number') {
            if (Math.abs(item) >= confirm && this.text && !this.text.endsWith(' ')) this.tj([{ s: ' ', w: this.fonts.get(this.font)?.space ?? 0 }]);
          } else {
            this.tj(item);
          }
        }
        break;
      }
      case "'": this.op('T*', []); this.op('Tj', args); break;
      case '"': this.op('T*', []); this.op('Tj', [args[2]]); break;
      case 'Do': this.flush(); if (this.output && !this.output.endsWith('\n')) this.output += '\n'; break;
      default: break;
    }
  }

  /** The text of the stream so far, as _extract_text() returns it. */
  result() { return this.output + this.text; }
}

/** Glyph runs of a pdf.js text argument: [{ s, w }], numbers (TJ spacing) kept between them. */
function runsOf(glyphs) {
  const out = [];
  let run = null;
  for (const g of glyphs) {
    if (typeof g === 'number') { run = null; out.push(g); continue; }
    if (!g) continue;
    if (!run) { run = []; out.push(run); }
    run.push({ s: g.unicode ?? '', w: Number(g.width) || 0 });
  }
  return out;
}

/** Space estimates per font from the glyphs the page draws: { halfSpace, space } in 1/1000 of the font size. */
function fontWidths(ops, OPS) {
  const stats = new Map();
  let font = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.setFont) { font = ops.argsArray[i][0]; if (!stats.has(font)) stats.set(font, { space: 0, sum: 0, n: 0 }); continue; }
    if (fn !== OPS.showText && fn !== OPS.showSpacedText && fn !== OPS.nextLineShowText && fn !== OPS.nextLineSetSpacingShowText) continue;
    const s = stats.get(font);
    if (!s) continue;
    const glyphs = fn === OPS.nextLineSetSpacingShowText ? ops.argsArray[i][2] : ops.argsArray[i][0];
    for (const g of glyphs || []) {
      if (!g || typeof g === 'number') continue;
      const w = Number(g.width) || 0;
      if (g.unicode === ' ' && w > 0 && !s.space) s.space = w;
      if (w > 0) { s.sum += w; s.n += 1; }
    }
  }
  const out = new Map();
  for (const [key, s] of stats) {
    const avg = s.n ? s.sum / s.n : 0;
    const space = s.space || avg / 2; // compute_space_width(): half the default width without a space glyph
    out.set(key, { halfSpace: space / 2, space: s.space || avg });
  }
  return out;
}

/** pdf.js operator list → pypdf's extraction, form XObjects as their own streams like extract_xform_text(). */
export function operatorListText(ops, OPS) {
  const fonts = fontWidths(ops, OPS);
  const stack = [new PypdfText(fonts)];
  const top = () => stack[stack.length - 1];
  const IMAGES = new Set([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((x) => x !== undefined));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i] || [];
    const x = top();
    switch (fn) {
      case OPS.beginText: x.op('BT'); break;
      case OPS.endText: x.op('ET'); break;
      case OPS.save: x.op('q'); break;
      case OPS.restore: x.op('Q'); break;
      case OPS.transform: x.op('cm', a); break;
      case OPS.setFont: x.op('Tf', a); break;
      case OPS.moveText: x.op('Td', a); break;
      case OPS.setLeadingMoveText: x.op('TD', a); break;
      case OPS.setTextMatrix: x.op('Tm', a.length === 1 && a[0]?.length === 6 ? Array.from(a[0]) : a); break; // pdf.js passes a Float32Array
      case OPS.nextLine: x.op('T*'); break;
      case OPS.setLeading: x.op('TL', a); break;
      case OPS.showText:
      case OPS.showSpacedText: {
        const runs = runsOf(a[0] || []);
        if (runs.some((r) => typeof r === 'number')) x.op('TJ', [runs]);
        else for (const r of runs) x.op('Tj', [r]);
        break;
      }
      case OPS.nextLineShowText: x.op('T*'); for (const r of runsOf(a[0] || [])) if (typeof r !== 'number') x.op('Tj', [r]); break;
      case OPS.nextLineSetSpacingShowText: x.op('T*'); for (const r of runsOf(a[2] || [])) if (typeof r !== 'number') x.op('Tj', [r]); break;
      case OPS.paintFormXObjectBegin: x.op('Do'); stack.push(new PypdfText(fonts, XFORM_ORIENTATIONS)); break;
      case OPS.paintFormXObjectEnd:
        if (stack.length > 1) { const form = stack.pop(); const parent = top(); parent.output += form.result(); parent.text = ''; }
        break;
      default:
        if (IMAGES.has(fn)) x.op('Do');
    }
  }
  while (stack.length > 1) { const form = stack.pop(); top().output += form.result(); }
  return stack[0].result();
}

/** { pages: [text per page], text: pages joined by a new line as ingestion's _pdf_text() does }. */
export async function pdfTextPages(buf) {
  const { getDocument, OPS, AnnotationMode } = await lib();
  const task = getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS, verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // annotations are not part of the page content pypdf reads
      const ops = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
      pages.push(operatorListText(ops, OPS));
      page.cleanup();
    }
    return { pages, text: pages.join('\n') };
  } finally {
    await task.destroy();
  }
}
