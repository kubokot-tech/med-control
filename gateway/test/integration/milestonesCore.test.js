import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, PDF, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('milestonescore'); });
after(async () => { if (db) await db.teardown(); });

const TZ = 'Europe/Moscow';
const Z = '00000000-0000-0000-0000-0000000000ff';
const notFound = (e) => e.name === 'CoreError' && e.kind === 'not_found';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');

test('create, update, list with files, insert extracted text, detach and delete', { skip: SKIP }, async () => {
  const ms = await import('../../src/lib/milestones.js');
  const m = await ms.createMilestone(USER_ID, { date: '2026-01-20', kind: 'histology', title: 'Биопсия', notes: 'первичная' }, { tz: TZ });
  assert.equal(m.kindLabel, 'Гистология');
  assert.equal(m.tone, 'neutral');
  const up = await ms.updateMilestone(USER_ID, m.id, { tone: 'negative', title: 'Биопсия печени' }, { tz: TZ });
  assert.equal(up.title, 'Биопсия печени');
  assert.equal(up.notes, 'первичная');
  const ev = await db.pool.query('select title, meta from events where id = $1', [m.eventId]);
  assert.equal(ev.rows[0].title, 'Гистология: Биопсия печени');
  assert.equal(ev.rows[0].meta.tone, 'negative');
  await assert.rejects(ms.updateMilestone(USER_ID, Z, { title: 'x' }, { tz: TZ }), notFound);

  const att = await ms.attachToMilestone(USER_ID, m.id, { buf: PNG, mime: 'image/png', filename: 'скан.png' }, { log: db.quiet });
  await assert.rejects(ms.attachToMilestone(USER_ID, Z, { buf: PNG, mime: 'image/png', filename: 'x.png' }, { log: db.quiet }), notFound);
  assert.equal(await ms.milestoneHasFile(USER_ID, m.id, att.sha256), true);
  assert.equal(await ms.milestoneHasFile(USER_ID, m.id, 'f'.repeat(64)), false);
  const [listed] = await ms.listMilestones(USER_ID);
  assert.deepEqual(listed.attachments.map((a) => [a.filename, a.mimeType, a.extract]), [['скан.png', 'image/png', null]]);

  await assert.rejects(ms.insertExtractIntoNotes(USER_ID, m.id, att.sha256), notFound, 'no text yet');
  await db.pool.query(`insert into attachment_extracts (user_id, sha256, method, text, summary) values ($1, $2, 'llm', 'Полный текст', 'Кратко')`, [USER_ID, att.sha256]);
  assert.equal(await ms.insertExtractIntoNotes(USER_ID, m.id, att.sha256, { variant: 'summary' }), 'первичная\n\nФайл: скан.png (кратко)\nКратко');
  assert.ok((await ms.listMilestones(USER_ID))[0].attachments[0].extract);

  await ms.removeMilestoneFile(USER_ID, m.id, att.sha256);
  await assert.rejects(ms.removeMilestoneFile(USER_ID, m.id, att.sha256), notFound);
  const ex = await db.pool.query('select count(*)::int c from attachment_extracts where sha256 = $1', [att.sha256]);
  assert.equal(ex.rows[0].c, 0, 'text released with the last file reference');

  await ms.deleteMilestone(USER_ID, m.id);
  await assert.rejects(ms.deleteMilestone(USER_ID, m.id), notFound);
  assert.equal((await db.pool.query('select count(*)::int c from events where id = $1', [m.eventId])).rows[0].c, 0);
});

test('batch: one milestone per file, imaging gets a study, bad files are reported, not fatal', { skip: SKIP }, async () => {
  const ms = await import('../../src/lib/milestones.js');
  const out = await ms.createMilestonesBatch(USER_ID, [
    { meta: { date: '2026-02-01', kind: 'consult', title: 'Онколог', tone: 'neutral' }, file: { filename: 'приём.pdf', mimetype: 'application/pdf', buf: PDF } },
    { meta: { date: '2026-02-05', kind: 'imaging', title: 'КТ', tone: 'neutral', modality: 'КТ', region: 'ОБП' }, file: { filename: 'кт.jpg', mimetype: 'application/octet-stream', buf: PNG } },
    { meta: { date: '2026-02-06', kind: 'other', title: 'пусто', tone: 'neutral' }, file: { filename: 'пусто.pdf', mimetype: 'application/pdf', buf: Buffer.alloc(0) } },
    { meta: { date: '2026-02-07', kind: 'other', title: 'архив', tone: 'neutral' }, file: { filename: 'a.zip', mimetype: 'application/zip', buf: PDF } },
  ], { tz: TZ, log: db.quiet });
  assert.equal(out.ok, false);
  assert.equal(out.created, 2);
  assert.deepEqual(out.results.map((r) => r.ok ? 'ok' : r.error), ['ok', 'ok', 'empty_file', 'unsupported_type']);
  assert.equal(out.results[0].studyId, null);
  const st = await db.pool.query('select modality, body_region, study_date::text d from imaging_studies where id = $1', [out.results[1].studyId]);
  assert.deepEqual(st.rows[0], { modality: 'КТ', body_region: 'ОБП', d: '2026-02-05' });
  assert.equal(out.results[1].attachment.mimeType, 'image/jpeg', 'mime from the extension when the phone sends octet-stream');
});

test('PATCH schema leaves omitted tone alone (zod 4 fills defaults inside partial())', { skip: SKIP }, async () => {
  const { MilestonePatch } = await import('../../src/routes/milestones.js');
  assert.deepEqual(MilestonePatch.parse({ title: 'Биопсия' }), { title: 'Биопсия' });
  assert.deepEqual(MilestonePatch.parse({ tone: 'positive' }), { tone: 'positive' });
  assert.equal(MilestonePatch.safeParse({ tone: 'odd' }).success, false);
});
