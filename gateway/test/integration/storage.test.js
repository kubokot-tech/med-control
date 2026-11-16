import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb, seedRegimen } from './helpers.js';

let db;
let ids;
before(async () => { if (!SKIP) { db = await setupDb('storage'); ids = await seedRegimen(db.pool); } });
after(async () => { if (db) await db.teardown(); });

const countNotes = async () => (await db.pool.query('select count(*)::int as c from notes where user_id=$1', [USER_ID])).rows[0].c;
const insertNote = (client, title) => client.query(`insert into notes (user_id, title, body) values ($1, $2, '')`, [USER_ID, title]);

test('transaction commits and returns the callback value', { skip: SKIP }, async () => {
  const { transaction } = await import('../../src/lib/db.js');
  const out = await transaction(async (client) => { await insertNote(client, 'a'); return 42; });
  assert.equal(out, 42);
  assert.equal(await countNotes(), 1);
});

test('transaction rolls back and rethrows on error', { skip: SKIP }, async () => {
  const { transaction } = await import('../../src/lib/db.js');
  await assert.rejects(transaction(async (client) => { await insertNote(client, 'b'); throw new Error('boom'); }), /boom/);
  assert.equal(await countNotes(), 1);
});

test('abort rolls back and resolves with its value', { skip: SKIP }, async () => {
  const { transaction, abort } = await import('../../src/lib/db.js');
  const out = await transaction(async (client) => { await insertNote(client, 'c'); abort('gone'); });
  assert.equal(out, 'gone');
  assert.equal(await countNotes(), 1);
  assert.equal(await transaction(async () => abort()), null);
});

test('deleteDose of an unknown id returns false without touching data', { skip: SKIP }, async () => {
  const { recordDose, deleteDose } = await import('../../src/lib/medsRecord.js');
  const r = await recordDose(USER_ID, { medicationId: ids.medicationId, regimenItemId: ids.regimenItemId, status: 'TAKEN', takenAt: '2026-02-01T09:00:00Z' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(await deleteDose(USER_ID, '00000000-0000-0000-0000-0000000000ff'), false);
  assert.equal(await deleteDose(USER_ID, r.id), true);
});

test('attachments go through the file store and are released with the last reference', { skip: SKIP }, async () => {
  const { transaction } = await import('../../src/lib/db.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const { releaseFile } = await import('../../src/lib/extracts.js');
  const fileStore = await import('../../src/lib/files.js');
  const { addEvent } = await import('../../src/lib/feed.js');
  const buf = Buffer.from('%PDF-1.4 storage test');
  const [e1, e2] = await transaction(async (c) => [
    await addEvent(c, USER_ID, { type: 'NOTE', occurredAt: '2026-02-02T10:00:00Z', title: 'a' }),
    await addEvent(c, USER_ID, { type: 'NOTE', occurredAt: '2026-02-03T10:00:00Z', title: 'b' }),
  ]);
  const a = await transaction((c) => storeAttachment(c, USER_ID, e1, buf, 'application/pdf', 'a.pdf'));
  await transaction((c) => storeAttachment(c, USER_ID, e2, buf, 'application/pdf', 'b.pdf'));
  const ref = (await db.pool.query('select file_url from attachments where sha256 = $1 limit 1', [a.sha256])).rows[0].file_url;
  assert.equal(ref, fileStore.refOf('uploads/milestones', `${a.sha256}.pdf`));
  assert.equal((await fileStore.read(ref)).toString(), buf.toString());
  await db.pool.query('delete from attachments where event_id = $1', [e1]);
  assert.equal(await releaseFile(USER_ID, a.sha256, ref), false, 'still referenced by the second event');
  assert.equal(await fileStore.exists(ref), true);
  await db.pool.query('delete from attachments where event_id = $1', [e2]);
  assert.equal(await releaseFile(USER_ID, a.sha256, ref), true);
  assert.equal(await fileStore.exists(ref), false);
});

test('pending AI drafts: save, resolve by prefix, load, sweep old ones, drop', { skip: SKIP }, async () => {
  const lc = await import('../../src/lib/labsCommit.js');
  const fileStore = await import('../../src/lib/files.js');
  const { utimes } = await import('node:fs/promises');
  const sha = 'ab'.repeat(32);
  const old = 'cd'.repeat(32);
  await lc.savePending(Buffer.from('%PDF-1.4 draft'), { sha256: sha, lab_name: 'Тест', observations: [] });
  await lc.savePending(Buffer.from('%PDF-1.4 old'), { sha256: old, observations: [] });
  assert.equal(await lc.resolvePending(sha.slice(0, 16)), sha);
  assert.equal(await lc.resolvePending('0'.repeat(16)), null);
  const p = await lc.loadPending(sha);
  assert.equal(p.draft.lab_name, 'Тест');
  assert.equal(p.buf.toString(), '%PDF-1.4 draft');
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
  for (const ext of ['pdf', 'json']) await utimes(fileStore.refOf('uploads/pending', `${old}.${ext}`), tenDaysAgo, tenDaysAgo);
  assert.equal(await lc.sweepPending(7, db.quiet), 2);
  assert.equal(await lc.loadPending(old), null);
  await lc.dropPending(sha);
  assert.equal(await lc.loadPending(sha), null);
  assert.deepEqual(await fileStore.list('uploads/pending'), []);
});
