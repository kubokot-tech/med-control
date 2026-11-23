import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x'; // labsCommit.js imports the pool; the pure part needs none
const { firstFilePart } = await import('../src/lib/multipart.js');
const { commitPdfFailure } = await import('../src/lib/labsCommit.js');

const filePart = (fieldname, bytes, name = 'a.pdf') => ({
  type: 'file', fieldname, filename: name, mimetype: 'application/pdf',
  toBuffer: async () => bytes,
  file: { resumed: false, resume() { this.resumed = true; } },
});

function reqWith(parts) {
  return { async *parts() { for (const p of parts) yield p; } };
}

test('firstFilePart takes the first «file» part and drains the rest without buffering them', async () => {
  const wanted = filePart('file', Buffer.from('one'));
  const extra = filePart('file', Buffer.from('two'));
  const other = filePart('other', Buffer.from('three'));
  const got = await firstFilePart(reqWith([{ type: 'field', fieldname: 'meta', value: '{}' }, wanted, extra, other]));
  assert.equal(got.buf.toString(), 'one');
  assert.equal(got.filename, 'a.pdf');
  assert.equal(got.mimetype, 'application/pdf');
  assert.ok(extra.file.resumed && other.file.resumed, 'extra file parts are drained');
});

test('firstFilePart reads the whole iterator even when the file comes last', async () => {
  const wanted = filePart('file', Buffer.from('late'));
  const got = await firstFilePart(reqWith([{ type: 'field', fieldname: 'x', value: '1' }, wanted]));
  assert.equal(got.buf.toString(), 'late');
});

test('firstFilePart returns null bytes when there is no file part', async () => {
  const got = await firstFilePart(reqWith([{ type: 'field', fieldname: 'x', value: '1' }]));
  assert.equal(got.buf, null);
});

test('commitPdfFailure maps the known codes and leaves anything else to the error handler', () => {
  assert.deepEqual(commitPdfFailure({ code: 'not_pdf' }).status, 415);
  assert.equal(commitPdfFailure({ code: 'ingestion_failed' }).status, 502);
  const empty = commitPdfFailure({ code: 'ai_empty', warnings: ['w'] });
  assert.equal(empty.status, 422);
  assert.deepEqual(empty.body.warnings, ['w']);
  for (const code of ['provider', 'bad_output', 'refusal']) assert.equal(commitPdfFailure({ code }).status, 502);
  assert.equal(commitPdfFailure({ code: 'something_else' }), null);
  assert.equal(commitPdfFailure(new Error('boom')), null);
});
