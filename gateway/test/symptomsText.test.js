import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSymptomsText } from '../src/lib/symptomsText.js';
import { lineDiff, diffStats } from '../src/lib/textDiff.js';

test('diary line: pressure, scales, weight, temperature, wellbeing', () => {
  const r = parseSymptomsText('давление 135/85, усталость 2, вес 116,5, темп 37.1, самочувствие 4, сон плохо, тошноты нет');
  assert.deepEqual(r.entry, { bpSys: 135, bpDia: 85, fatigue: 2, weightKg: 116.5, tempC: 37.1, wellbeing: 4, sleepQuality: 2, nausea: 0 });
  assert.equal(r.yesterday, false);
  assert.deepEqual(r.unknown, []);
});

test('diary line: yesterday, bare pressure, unknown text goes to notes', () => {
  const r = parseSymptomsText('Вчера 140/90, диарея сильно, болела голова, гулял в парке');
  assert.equal(r.yesterday, true);
  assert.equal(r.entry.bpSys, 140);
  assert.equal(r.entry.diarrhea, 3);
  assert.equal(r.entry.headache, 2, 'a headache is a scale now, not a note');
  assert.deepEqual(r.unknown, ['гулял в парке']);
  assert.equal(r.entry.notes, 'гулял в парке');
});

test('diary line: new scales, specific before generic pain', () => {
  const r = parseSymptomsText('отёки 2, одышка слабо, суставы 3, болит горло, боль 1');
  assert.equal(r.entry.edema, 2);
  assert.equal(r.entry.dyspnea, 1);
  assert.equal(r.entry.jointPain, 3);
  assert.equal(r.entry.throatPain, 2);
  assert.equal(r.entry.pain, 1);
  assert.equal(r.entry.headache, undefined);
});

test('diary line: keyword without a level counts as moderate; notes prefix', () => {
  const r = parseSymptomsText('усталость, заметка: гулял час');
  assert.equal(r.entry.fatigue, 2);
  assert.equal(r.entry.notes, 'гулял час');
});

test('non-diary text is not a diary line', () => {
  assert.equal(parseSymptomsText('привет'), null);
  assert.equal(parseSymptomsText('принял'), null);
  assert.equal(parseSymptomsText('когда следующий приём?'), null);
});

test('line diff', () => {
  const d = lineDiff('a\nb\nc', 'a\nc\nd');
  assert.deepEqual(d.map((x) => x.type + ':' + x.text), ['same:a', 'del:b', 'same:c', 'add:d']);
  assert.deepEqual(diffStats(d), { added: 1, removed: 1 });
});

test('diary line in English: the same fields as the Russian line, whatever the setting', () => {
  const r = parseSymptomsText('pressure 135/85, fatigue 2, weight 71, temp 37.2, pulse 72, wellbeing 4, sleep bad, no nausea');
  assert.deepEqual(r.entry, { bpSys: 135, bpDia: 85, fatigue: 2, weightKg: 71, tempC: 37.2, pulse: 72, wellbeing: 4, sleepQuality: 2, nausea: 0 });
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.entry, parseSymptomsText('давление 135/85, усталость 2, вес 71, темп 37.2, пульс 72, самочувствие 4, сон плохо, тошноты нет').entry);
});

test('diary line in English: yesterday, bp, levels in words, specific scales before generic pain, notes', () => {
  const r = parseSymptomsText('Yesterday bp 140 over 90, diarrhea severe, headache, shortness of breath mild, joint pain 3, sore throat, pain 1, walked in the park, note: felt ok');
  assert.equal(r.yesterday, true);
  assert.deepEqual([r.entry.bpSys, r.entry.bpDia], [140, 90]);
  assert.equal(r.entry.diarrhea, 3);
  assert.equal(r.entry.headache, 2);
  assert.equal(r.entry.dyspnea, 1);
  assert.equal(r.entry.jointPain, 3);
  assert.equal(r.entry.throatPain, 2);
  assert.equal(r.entry.pain, 1);
  assert.deepEqual(r.unknown, ['walked in the park']);
  assert.equal(r.entry.notes, 'felt ok; walked in the park');
  assert.equal(parseSymptomsText('sleep not good').entry.sleepQuality, 2, '«not good» is not «good»');
  assert.equal(parseSymptomsText('wellbeing 4 of 5').entry.wellbeing, 4);
  assert.equal(parseSymptomsText('nausea 2 out of 3').entry.nausea, 2);
});

test('diary line: units. A written unit wins, a bare number is in the user\'s units, the entry holds kg and °C', () => {
  assert.equal(parseSymptomsText('weight 160 lb').entry.weightKg, 72.57);
  assert.equal(parseSymptomsText('weight 160', { weight: 'lb' }).entry.weightKg, 72.57);
  assert.equal(parseSymptomsText('weight 71 kg', { weight: 'lb' }).entry.weightKg, 71);
  assert.equal(parseSymptomsText('вес 71').entry.weightKg, 71);
  assert.equal(parseSymptomsText('temp 101.3 f').entry.tempC, 38.5);
  assert.equal(parseSymptomsText('temp 101.3', { temperature: 'f' }).entry.tempC, 38.5);
  assert.equal(parseSymptomsText('temp 37.2', { temperature: 'f' }).entry.tempC, 37.2, 'a number that can only be Celsius');
  assert.equal(parseSymptomsText('temp 101.3'), null, 'never stored as 101 °C');
});

test('English non-diary text is not a diary line', () => {
  for (const s of ['hello', 'taken', 'how are you', 'when is the next appointment?']) assert.equal(parseSymptomsText(s), null, s);
});
