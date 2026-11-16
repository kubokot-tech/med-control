/**
 * The anamnesis from a document the person already has, for the first-run steps: text layer of a PDF, otherwise text
 * recognition on this machine. Nothing leaves the server and nothing is stored here: the text comes back to the screen,
 * the person reads it, and only what they save becomes the anamnesis.
 */
import { pdfPlainText } from './pdfEngine.js';
import { ocrFile } from './ocr.js';

export const ANAMNESIS_MAX = 20000;
const MIN_PDF_CHARS = 80; // below this the PDF is most likely a scan

const fail = (code) => Object.assign(new Error(code), { code });
const isPdf = (b) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const imageType = (b) => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
};
const isPlainText = (filename) => /\.(txt|md)$/i.test(filename || '');

/** Page marks are for the code that keeps extracts; here a person reads the text. */
export const cleanExtract = (text) => String(text || '').replace(/<!--[^>]*-->\n?/g, '').replace(/\n{3,}/g, '\n\n').trim();

/** { text, method: 'text' | 'ocr', truncated }. Throws { code }: unsupported_file, no_text_in_file, ocr_failed. */
export async function anamnesisFromFile(buf, filename, { pdfText = pdfPlainText, ocr = ocrFile } = {}) {
  let text = '';
  let method = 'text';
  if (isPdf(buf)) {
    text = cleanExtract((await pdfText(buf, filename)).text);
    if (text.length < MIN_PDF_CHARS) {
      method = 'ocr';
      text = cleanExtract((await ocr({ mimeType: 'application/pdf', data: buf })).text);
    }
  } else if (imageType(buf)) {
    method = 'ocr';
    text = cleanExtract((await ocr({ mimeType: imageType(buf), data: buf })).text);
  } else if (isPlainText(filename)) {
    text = cleanExtract(buf.toString('utf8'));
  } else {
    throw fail('unsupported_file');
  }
  if (!text) throw fail('no_text_in_file');
  return { text: text.slice(0, ANAMNESIS_MAX), method, truncated: text.length > ANAMNESIS_MAX };
}
