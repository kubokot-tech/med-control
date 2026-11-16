import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, PDF, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('imagingcore'); });
after(async () => { if (db) await db.teardown(); });

const TZ = 'Europe/Moscow';
const Z = '00000000-0000-0000-0000-0000000000ff';
const notFound = (e) => e.name === 'CoreError' && e.kind === 'not_found';

test('studies mirror a milestone; lesions and measurements give RECIST against baseline', { skip: SKIP }, async () => {
  const im = await import('../../src/lib/imaging.js');
  const base = await im.createStudy(USER_ID, { date: '2026-01-10', modality: 'КТ', region: 'ОГК', impression: 'Очаги в лёгких' }, { tz: TZ });
  const next = await im.createStudy(USER_ID, { date: '2026-04-10', modality: 'КТ', region: 'ОГК' }, { tz: TZ });
  assert.ok(base.milestoneId);
  const ms = await db.pool.query('select kind, tone, title from milestones where id = $1', [base.milestoneId]);
  assert.deepEqual(ms.rows[0], { kind: 'imaging', tone: 'neutral', title: 'КТ ОГК' });

  const upd = await im.updateStudy(USER_ID, next.id, { response: 'PR' }, { tz: TZ });
  assert.equal(upd.responseLabel, 'частичный ответ');
  const ms2 = await db.pool.query('select tone, title from milestones where id = $1', [next.milestoneId]);
  assert.deepEqual(ms2.rows[0], { tone: 'positive', title: 'КТ ОГК: частичный ответ' });
  const ev = await db.pool.query(`select e.title from events e join milestones m on m.event_id = e.id where m.id = $1`, [next.milestoneId]);
  assert.equal(ev.rows[0].title, 'Контроль КТ/МРТ/ПЭТ: КТ ОГК: частичный ответ');

  const l1 = await im.createLesion(USER_ID, { name: 'S6 правого лёгкого' });
  const l2 = await im.createLesion(USER_ID, { name: 'Лимфоузел', location: 'средостение', isTarget: false });
  assert.equal(l1.isTarget, true);
  assert.equal((await im.updateLesion(USER_ID, l2.id, { isTarget: true })).isTarget, true);
  await im.saveMeasurements(USER_ID, base.id, [{ lesionId: l1.id, sizeMm: 20 }, { lesionId: l2.id, sizeMm: 30 }]);
  await im.saveMeasurements(USER_ID, next.id, [{ lesionId: l1.id, sizeMm: 12 }, { lesionId: l2.id, sizeMm: 20, note: 'уменьшился' }]);
  const o = await im.imagingOverview(USER_ID);
  assert.deepEqual(o.studies.map((s) => s.date), ['2026-04-10', '2026-01-10']);
  assert.deepEqual(o.studies[0].measurements[l2.id], { sizeMm: 20, note: 'уменьшился' });
  assert.deepEqual(o.recist.map((r) => [r.date, r.sum, r.response, r.changeFromBaselinePct]), [['2026-01-10', 50, 'baseline', 0], ['2026-04-10', 32, 'PR', -36]]);
  assert.ok(o.responses.PR);

  await im.saveMeasurements(USER_ID, next.id, [{ lesionId: l2.id, sizeMm: null }]);
  assert.equal((await im.imagingOverview(USER_ID)).studies[0].measurements[l2.id], undefined, 'empty entry removes the measurement');

  await im.deleteLesion(USER_ID, l2.id);
  await assert.rejects(im.deleteLesion(USER_ID, l2.id), notFound);
  await assert.rejects(im.updateLesion(USER_ID, Z, { name: 'x' }), notFound);
  await assert.rejects(im.updateStudy(USER_ID, Z, { modality: 'МРТ' }, { tz: TZ }), notFound);
  await assert.rejects(im.saveMeasurements(USER_ID, Z, []), notFound);
});

test('parseStudyReport reads the study files and stores the AI comment; deleteStudy cleans up', { skip: SKIP }, async () => {
  const im = await import('../../src/lib/imaging.js');
  const { transaction } = await import('../../src/lib/db.js');
  const { storeAttachment } = await import('../../src/lib/attachmentsStore.js');
  const st = await im.createStudy(USER_ID, { date: '2026-05-01', modality: 'МРТ', region: 'печень' }, { tz: TZ });
  const ev = (await db.pool.query('select event_id from milestones where id = $1', [st.milestoneId])).rows[0].event_id;
  const att = await transaction((c) => storeAttachment(c, USER_ID, ev, PDF, 'application/pdf', 'заключение.pdf'));

  let seen;
  const parse = async ({ files, text }) => { seen = { files, text }; return { report: { modality: 'МРТ', impression: 'Без динамики', response: 'SD' }, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test-model' }; };
  const out = await im.parseStudyReport(USER_ID, st.id, 'вставленный текст', { parse });
  assert.equal(seen.files.length, 1);
  assert.equal(seen.files[0].mimeType, 'application/pdf');
  assert.ok(seen.files[0].data.equals(PDF));
  assert.equal(seen.text, 'вставленный текст');
  assert.deepEqual(out.usage, { input: 10, output: 5 });
  const c = await db.pool.query(`select model, text from ai_comments where subject_type = 'imaging_study' and subject_id = $1`, [st.id]);
  assert.equal(c.rows[0].model, 'test-model');
  assert.match(c.rows[0].text, /Без динамики/);
  await assert.rejects(im.parseStudyReport(USER_ID, Z, '', { parse }), notFound);

  await im.deleteStudy(USER_ID, st.id);
  await assert.rejects(im.deleteStudy(USER_ID, st.id), notFound);
  const left = await db.pool.query('select (select count(*)::int from milestones where id = $1) as ms, (select count(*)::int from events where id = $2) as ev, (select count(*)::int from attachments where sha256 = $3) as att', [st.milestoneId, ev, att.sha256]);
  assert.deepEqual(left.rows[0], { ms: 0, ev: 0, att: 0 });
});
