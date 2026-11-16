import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let fileStore;
before(async () => {
  process.env.DTC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mc-files-'));
  fileStore = await import('../src/lib/files.js');
});

test('put returns a ref under DATA_DIR; read, exists, remove', async () => {
  const ref = await fileStore.put('uploads/milestones', 'abc.pdf', Buffer.from('%PDF-1.4'));
  assert.equal(ref, path.join(process.env.DTC_DATA_DIR, 'uploads', 'milestones', 'abc.pdf'));
  assert.equal(ref, fileStore.refOf('uploads/milestones', 'abc.pdf'));
  assert.equal((await fileStore.read(ref)).toString(), '%PDF-1.4');
  assert.equal(await fileStore.exists(ref), true);
  assert.equal(await fileStore.remove(ref), true);
  assert.equal(await fileStore.exists(ref), false);
  assert.equal(await fileStore.remove(ref), false, 'a missing file is not an error');
});

test('list: missing area is empty, recursive gives relative names', async () => {
  assert.deepEqual(await fileStore.list('nothing'), []);
  await fileStore.put('uploads', 'a.pdf', 'a');
  await fileStore.put('uploads/pending', 'b.json', '{"x":1}');
  assert.deepEqual((await fileStore.list('uploads')).map((f) => f.name), ['a.pdf']);
  assert.deepEqual((await fileStore.list('uploads', { recursive: true })).map((f) => f.name).sort(), ['a.pdf', path.join('pending', 'b.json')]);
  const [b] = await fileStore.list('uploads/pending');
  assert.equal(JSON.parse(await fileStore.readText(b.ref)).x, 1);
  assert.ok(b.mtimeMs > 0);
});

test('areas and names cannot escape DATA_DIR', async () => {
  for (const area of ['../etc', '/abs', 'Uploads', 'uploads/../x', '']) await assert.rejects(fileStore.put(area, 'a.txt', 'x'), /bad file area/);
  for (const name of ['../a', 'a/b', '.hidden', '', 'a b']) assert.throws(() => fileStore.refOf('uploads', name), /bad file name/);
});
