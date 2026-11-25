import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecist } from '../src/lib/recist.js';

const lesions = [{ id: 'a', isTarget: true }, { id: 'b', isTarget: true }, { id: 'n', isTarget: false }];
const studies = [{ id: 's1', date: '2026-01-10' }, { id: 's2', date: '2026-04-10' }, { id: 's3', date: '2026-07-10' }, { id: 's4', date: '2026-10-10' }];

test('baseline, PR, SD and PD in sequence', () => {
  const m = [
    { studyId: 's1', lesionId: 'a', sizeMm: 20 }, { studyId: 's1', lesionId: 'b', sizeMm: 10 }, { studyId: 's1', lesionId: 'n', sizeMm: 50 },
    { studyId: 's2', lesionId: 'a', sizeMm: 12 }, { studyId: 's2', lesionId: 'b', sizeMm: 8 },   // 20 = -33% -> PR
    { studyId: 's3', lesionId: 'a', sizeMm: 13 }, { studyId: 's3', lesionId: 'b', sizeMm: 9 },   // 22 = +10% vs nadir -> SD
    { studyId: 's4', lesionId: 'a', sizeMm: 16 }, { studyId: 's4', lesionId: 'b', sizeMm: 10 },  // 26 = +30% and +6mm vs nadir 20 -> PD
  ];
  const r = computeRecist(studies, lesions, m);
  assert.deepEqual(r.map((x) => [x.sum, x.response]), [[30, 'baseline'], [20, 'PR'], [22, 'SD'], [26, 'PD']]);
  assert.equal(r[3].nadir, 20);
  assert.equal(r[1].changeFromBaselinePct, -33);
});

test('studies without target measurements are skipped; small growth is SD', () => {
  const m = [
    { studyId: 's1', lesionId: 'a', sizeMm: 10 },
    { studyId: 's3', lesionId: 'a', sizeMm: 13 }, // +30% but only +3mm -> SD
  ];
  const r = computeRecist(studies, lesions, m);
  assert.deepEqual(r.map((x) => [x.studyId, x.response]), [['s1', 'baseline'], ['s3', 'SD']]);
});

test('complete response when everything is gone', () => {
  const m = [{ studyId: 's1', lesionId: 'a', sizeMm: 10 }, { studyId: 's2', lesionId: 'a', sizeMm: 0 }];
  assert.equal(computeRecist(studies, lesions, m)[1].response, 'CR');
});

test('modality groups are compared separately, same-date studies ordered by createdAt', () => {
  const studies = [
    { id: 'mri', date: '2026-08-05', modality: 'МРТ', createdAt: '2026-09-01' },
    { id: 'pet0', date: '2025-12-24', modality: 'ПЭТ-КТ', createdAt: '2026-09-01' },
    { id: 'pet1', date: '2026-08-05', modality: 'ПЭТ-КТ', createdAt: '2026-09-02' },
  ];
  const lesions = [{ id: 'lung', isTarget: true }, { id: 'node', isTarget: true }];
  const meas = [
    { studyId: 'pet0', lesionId: 'lung', sizeMm: 14 },
    { studyId: 'pet1', lesionId: 'lung', sizeMm: 14 },
    { studyId: 'mri', lesionId: 'node', sizeMm: 7 },
  ];
  const r = computeRecist(studies, lesions, meas);
  const pet = r.find((x) => x.studyId === 'pet1');
  const mri = r.find((x) => x.studyId === 'mri');
  assert.equal(pet.group, 'КТ');
  assert.equal(pet.response, 'SD');
  assert.equal(pet.changeFromBaselinePct, 0);
  assert.equal(mri.group, 'МРТ');
  assert.equal(mri.response, 'baseline');
});

test('missing targets give no numeric response and do not lower the nadir', () => {
  const measurements = [
    { studyId: 's1', lesionId: 'a', sizeMm: 20 }, { studyId: 's1', lesionId: 'b', sizeMm: 20 },
    { studyId: 's2', lesionId: 'a', sizeMm: 20 },
    { studyId: 's3', lesionId: 'a', sizeMm: 20 }, { studyId: 's3', lesionId: 'b', sizeMm: 20 },
  ];
  const points = computeRecist(studies, lesions, measurements);
  assert.deepEqual(points.map((p) => [p.response, p.sum, p.nadir]), [['baseline', 40, 40], ['NA', null, 40], ['SD', 40, 40]]);
  assert.equal(points[1].changeFromBaselinePct, null);
});

test('growth from the nadir takes precedence over shrinkage from baseline', () => {
  const points = computeRecist(studies, lesions, [100, 40, 60].map((sizeMm, i) => ({ studyId: studies[i].id, lesionId: 'a', sizeMm })));
  assert.deepEqual(points.map((p) => p.response), ['baseline', 'PR', 'PD']);
});
