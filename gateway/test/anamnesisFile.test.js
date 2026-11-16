import test from 'node:test';
import assert from 'node:assert/strict';
import { anamnesisFromFile, ANAMNESIS_MAX, cleanExtract } from '../src/lib/anamnesisFile.js';

const PDF = Buffer.from('%PDF-1.7 anything');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const LONG = 'Диагноз и лечение. '.repeat(10);

test('a PDF with a text layer is read as text, no recognition', async () => {
  const r = await anamnesisFromFile(PDF, 'a.pdf', { pdfText: async () => ({ text: `<!-- страница 1 -->\n${LONG}` }), ocr: async () => assert.fail('no OCR needed') });
  assert.deepEqual(r, { text: LONG.trim(), method: 'text', truncated: false });
});

test('a scanned PDF and a photo go to recognition on this machine', async () => {
  const ocr = async ({ mimeType }) => ({ text: `распознано: ${mimeType}` });
  assert.equal((await anamnesisFromFile(PDF, 'a.pdf', { pdfText: async () => ({ text: '' }), ocr })).text, 'распознано: application/pdf');
  const photo = await anamnesisFromFile(JPEG, 'a.jpg', { ocr });
  assert.deepEqual([photo.text, photo.method], ['распознано: image/jpeg', 'ocr']);
});

test('text files are read, other formats are refused, an empty result is an error', async () => {
  assert.equal((await anamnesisFromFile(Buffer.from('Анамнез'), 'a.txt')).text, 'Анамнез');
  await assert.rejects(() => anamnesisFromFile(Buffer.from('PK\x03\x04'), 'a.docx'), { code: 'unsupported_file' });
  await assert.rejects(() => anamnesisFromFile(Buffer.from('   '), 'a.txt'), { code: 'no_text_in_file' });
});

test('a long document is cut to what the anamnesis can hold, and says so', async () => {
  const r = await anamnesisFromFile(Buffer.from('а'.repeat(ANAMNESIS_MAX + 5)), 'a.txt');
  assert.equal(r.text.length, ANAMNESIS_MAX);
  assert.equal(r.truncated, true);
});

test('page marks and long gaps are removed', () => {
  assert.equal(cleanExtract('<!-- страница 1 -->\nа\n\n\n\n<!-- страница 2 -->\nб'), 'а\n\nб');
});
