import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { toPnm, pdfPageImages, ocrFile, needsPageOcr, pdfLayers } from '../src/lib/ocr.js';

// A picture of test/makeLayoutPdfs.js «rows» (invented data) at a low resolution, like a phone photo of a lab blank.
const SCAN = fs.readFileSync(fileURLToPath(new URL('./fixtures/scan-rows.jpg', import.meta.url)));
const ROWS_PDF = fs.readFileSync(fileURLToPath(new URL('../../ingestion/tests/fixtures/pdf/rows.pdf', import.meta.url)));

function scanPdf(pages) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    for (let i = 0; i < pages; i++) { doc.addPage({ size: 'A4', margin: 0 }); doc.image(SCAN, 0, 0, { width: 595 }); }
    doc.end();
  });
}

test('pdf.js bitmaps become PNM: 1 bit (a set bit is white), RGB, RGBA', () => {
  const bw = toPnm({ width: 3, height: 1, kind: 1, data: Uint8Array.from([0b10100000]) });
  assert.deepEqual([...bw.subarray(bw.length - 3)], [255, 0, 255]);
  assert.match(bw.subarray(0, 11).toString(), /^P5\n3 1\n255\n/);
  const rgb = toPnm({ width: 1, height: 1, kind: 2, data: Uint8Array.from([1, 2, 3]) });
  assert.deepEqual([...rgb.subarray(rgb.length - 3)], [1, 2, 3]);
  const rgba = toPnm({ width: 2, height: 1, kind: 3, data: Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]) });
  assert.deepEqual([...rgba.subarray(rgba.length - 6)], [1, 2, 3, 4, 5, 6]);
});

test('a PDF with a text layer has no page picture to recognise', async () => {
  assert.deepEqual(await pdfPageImages(ROWS_PDF), [null]);
});

test('a photo and a scanned PDF are recognised on this machine, pages marked', async () => {
  const photo = await ocrFile({ mimeType: 'image/jpeg', data: SCAN });
  assert.equal(photo.pages, 1);
  assert.match(photo.text, /Общий анализ крови/);
  assert.match(photo.text, /Гемоглобин 132/);
  const pdf = await ocrFile({ mimeType: 'application/pdf', data: await scanPdf(2) });
  assert.equal(pdf.pages, 2);
  assert.match(pdf.text, /^<!-- страница 1 -->\n[\s\S]*Гемоглобин 132[\s\S]*<!-- страница 2 -->\n/);
});

test('a file that is not an image fails with a clear code', async () => {
  await assert.rejects(ocrFile({ mimeType: 'application/pdf', data: Buffer.from('not a pdf') }), (e) => e.code === 'ocr_failed');
});

test('mixed documents retain their text layers and OCR a scan beyond page 20', async () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', resolve));
  const layer = 'Original text layer. '.repeat(5);
  for (let i = 0; i < 20; i++) doc.addPage().text(layer);
  doc.addPage().image(SCAN, 0, 0, { width: 595 });
  doc.addPage(); // An empty final page is reflected in the completeness warning.
  doc.end();
  await done;
  const layers = Array(20).fill(layer).concat('', '');
  assert.equal(needsPageOcr({ pages: layers }), true);
  assert.deepEqual(pdfLayers({ pages: 3, text: '<!-- страница 1 -->\nhello\n\n<!-- страница 3 -->\nworld' }), ['hello', '', 'world']);
  const result = await ocrFile({ data: Buffer.concat(chunks), mimeType: 'application/pdf', layers, language: 'en' });
  assert.equal(result.pages, 22);
  assert.equal(result.unreadPages, 1);
  assert.match(result.text, /<!-- страница 1 -->\nOriginal text layer/);
  assert.match(result.text, /<!-- страница 21 -->[\s\S]*Гемоглобин 132/);
  assert.match(result.text, /1 of 22/);
});
