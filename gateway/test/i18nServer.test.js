import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t, raw, has, relocalize, matchMessage } from '../src/lib/i18n.js';
import { CATALOG_SEED } from '../src/lib/catalogSeed.js';
import { catalog, markerName, markerShort, displayName } from '../src/lib/canonical.js';
import { scaleCatalog, scaleShort, SCALE_CATALOG } from '../src/lib/diaryScales.js';
import { describeSchedule } from '../src/lib/schedule.js';
import { BASE_LAB_RULES, PRESETS, listPresets, protocolFromPreset, protocolIn, presetText, withStatus } from '../src/lib/protocol.js';
import { presetsIn } from '../src/lib/protocolPresets.js';
import { labFindings, symptomFindings, rowToAlert } from '../src/lib/alerts.js';
import { feedText, milestoneTitle, studyTitle, doseNote, kindLabel, modalityLabel } from '../src/lib/eventText.js';
import { responseLabels } from '../src/lib/recist.js';
import { PROVIDERS } from '../src/lib/llmProviders.js';
import { MODALITIES, ROUTES, modalityCode, routeCode } from '../../shared/medCodes.js';
import { createFormat } from '../../shared/format.js';

process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x'; // milestones.js imports the pool; the labels need none
const { kindLabels } = await import('../src/lib/milestones.js');

const locale = (lang, file) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../locales/${lang}/${file}`, import.meta.url)), 'utf8'));
const CYRILLIC = /[А-Яа-яЁё]/;
const EN = createFormat({ language: 'en', prefs: { region: 'US' } });

test('t: a message in the language, ICU arguments and plurals', () => {
  assert.equal(t('en', 'feedTitles.medStop', { name: 'Lenvatinib' }), 'Stopped Lenvatinib');
  assert.equal(t('ru', 'feedTitles.medStop', { name: 'Ленватиниб' }), 'Отменён Ленватиниб');
  assert.equal(t('ru', 'schedule.timesPerDay', { n: 3 }), '3 раза в день');
  assert.equal(t('en', 'schedule.timesPerDay', { n: 2 }), 'twice a day');
});

test('t and raw: an unknown language reads Russian, a missing key falls back to Russian and then to itself', () => {
  assert.equal(t('de', 'feedTitles.medStop', { name: 'X' }), 'Отменён X');
  assert.equal(t(undefined, 'feedTitles.medStop', { name: 'X' }), 'Отменён X');
  assert.equal(raw('en', 'no.such.key'), 'no.such.key');
  assert.equal(has('en', 'no.such.key'), false);
  assert.equal(raw('en', 'errors.__proto__'), 'errors.__proto__', 'object internals are not keys');
});

test('raw keeps a template as written; shared sections are readable too', () => {
  assert.match(raw('en', 'presets.base.rules.NEUT#_RED_lt'), /^Neutrophils \{v\} \{u\}:/);
  assert.equal(raw('en', 'history.kindLabels.surgery'), 'Surgery');
});

test('relocalize: our message from another language follows the reader, anything else stays', () => {
  assert.equal(relocalize('Отменён Ленватиниб', ['feedTitles.medStop'], 'en'), 'Stopped Ленватиниб');
  assert.equal(relocalize('Stopped Ленватиниб', ['feedTitles.medStop'], 'ru'), 'Отменён Ленватиниб');
  assert.equal(relocalize('Отменён Ленватиниб', ['feedTitles.medStop'], 'ru'), 'Отменён Ленватиниб', 'already in the reader\'s language');
  assert.equal(relocalize('Мой текст', ['feedTitles.medStop'], 'en'), 'Мой текст');
  assert.equal(relocalize(null, ['feedTitles.medStop'], 'en'), null);
  assert.equal(matchMessage('Stopped X', ['feedTitles.medStop'], 'en'), null, 'a text in the reader\'s language is not even looked at');
});

test('markers: the Russian dictionary is the catalog word for word, no entry is missing', () => {
  const ru = locale('ru', 'server/markers.json');
  const en = locale('en', 'server/markers.json');
  assert.deepEqual(Object.keys(ru).sort(), CATALOG_SEED.map((e) => e.key).sort());
  for (const e of CATALOG_SEED) assert.deepEqual(ru[e.key], { name: e.name, short: e.short ?? e.key }, e.key);
  for (const [k, v] of Object.entries(en)) assert.doesNotMatch(`${v.name} ${v.short}`, CYRILLIC, k);
});

test('markers: names by language, keys with # % and - work', () => {
  assert.equal(markerName('ALT', 'ru'), 'Аланинаминотрансфераза (АЛТ)');
  assert.equal(markerName('ALT', 'en'), 'Alanine aminotransferase (ALT)');
  assert.equal(markerShort('HGB', 'en'), 'Hemoglobin');
  assert.equal(markerShort('NEUT#', 'en'), 'Neutrophils');
  assert.equal(markerShort('NEUT%', 'en'), 'Neutrophils %');
  assert.equal(markerName('U-PRO', 'en'), 'Protein in urine');
  assert.equal(markerName('not-a-marker', 'en'), 'not-a-marker');
  assert.equal(displayName('ALT'), 'Аланинаминотрансфераза (АЛТ)', 'Russian is the source language of the catalog');
  assert.deepEqual(catalog().map((c) => c.short), CATALOG_SEED.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((e) => e.short ?? e.key));
  assert.ok(catalog('en').every((c) => !CYRILLIC.test(c.name + c.short)));
});

test('diary scales: the catalog keeps its Russian words, the list for the screen follows the language', () => {
  assert.equal(SCALE_CATALOG[0].label, 'Усталость');
  assert.equal(scaleCatalog()[0].hint, 'сил меньше обычного');
  assert.deepEqual(scaleCatalog('en')[0], { key: 'fatigue', label: 'Fatigue', hint: 'less energy than usual' });
  assert.equal(scaleCatalog('en').find((s) => s.key === 'nausea').hint, '');
  assert.equal(scaleShort('handFoot'), 'ладони/стопы');
  assert.equal(scaleShort('handFoot', 'en'), 'palms/soles');
  assert.equal(scaleShort('unknown', 'en'), 'unknown');
  for (const s of scaleCatalog('en')) assert.doesNotMatch(`${s.label} ${s.hint}`, CYRILLIC, s.key);
});

test('schedule text in English', () => {
  const start = '2026-01-05';
  assert.equal(describeSchedule({ frequencyRule: 'DAILY' }, 'en'), 'once a day');
  assert.equal(describeSchedule({ frequencyRule: 'DAILY', timesPerDay: 2 }, 'en'), 'twice a day');
  assert.equal(describeSchedule({ frequencyRule: 'DAILY', timesPerDay: 3 }, 'en'), '3 times a day');
  assert.equal(describeSchedule({ frequencyRule: 'WEEKLY', scheduleDays: [1], startDate: start }, 'en'), 'on Mondays');
  assert.equal(describeSchedule({ frequencyRule: 'WEEKLY', scheduleDays: [1, 4], startDate: start }, 'en'), 'on Mon and Thu');
  assert.equal(describeSchedule({ frequencyRule: 'WEEKLY', scheduleDays: [1, 3, 5], timesPerDay: 2, startDate: start }, 'en'), 'on Mon, Wed, and Fri, twice a day');
  assert.equal(describeSchedule({ frequencyRule: 'EVERY_N_DAYS', intervalDays: 3, startDate: start }, 'en'), 'every 3 days');
});

test('presets: thresholds are one set, only the words differ', () => {
  const en = presetsIn('en');
  assert.equal(en.length, PRESETS.length);
  PRESETS.forEach((p, i) => {
    assert.deepEqual(en[i].labRules.map(({ key, severity, op, value }) => [key, severity, op, value]), p.labRules.map(({ key, severity, op, value }) => [key, severity, op, value]), p.id);
    assert.deepEqual(en[i].diaryScales, p.diaryScales);
    assert.equal(en[i].regimen?.doseValue, p.regimen?.doseValue);
    assert.deepEqual(en[i].infusionAgents.map((a) => a.defaultDose), p.infusionAgents.map((a) => a.defaultDose));
    assert.deepEqual(Object.keys(en[i].markerNotes), Object.keys(p.markerNotes));
    assert.doesNotMatch(JSON.stringify(en[i]), CYRILLIC, p.id);
    en[i].labRules.forEach((r, n) => assert.deepEqual(r.message.match(/\{\w+\}/g), p.labRules[n].message.match(/\{\w+\}/g), `${p.id} ${r.key}`));
  });
  assert.equal(listPresets('en').find((p) => p.id === 'generic').name, 'General lab monitoring');
  assert.equal(listPresets().find((p) => p.id === 'generic').name, 'Общий контроль анализов');
  assert.equal(BASE_LAB_RULES.length, 12);
});

test('one Russian preset text has one English text', () => {
  const pairs = new Map();
  PRESETS.forEach((p, i) => p.labRules.forEach((r, n) => {
    const en = presetsIn('en')[i].labRules[n].message;
    assert.equal(pairs.get(r.message) ?? en, en, r.message);
    pairs.set(r.message, en);
  }));
});

test('a stored protocol shows in the reader\'s language, comes back to Russian on save and keeps its status', () => {
  const stored = protocolFromPreset('lenvatinib');
  assert.equal(stored.name, 'Ленватиниб');
  const en = protocolIn(stored, 'en');
  assert.equal(en.name, 'Lenvatinib');
  assert.equal(en.regimen.doseUnit, 'mg');
  assert.equal(en.regimen.doseValue, 24);
  assert.doesNotMatch(JSON.stringify(en), CYRILLIC);
  assert.deepEqual(protocolIn(en, 'ru'), stored);
  assert.equal(withStatus(protocolIn(en, 'ru')).status, 'ready');
  assert.deepEqual(protocolIn(stored, 'ru'), stored, 'Russian is the stored text itself');
});

test('what the user changed in a protocol stays as written', () => {
  const stored = protocolFromPreset('generic');
  const mine = { ...stored, labCadenceHint: 'Раз в месяц', labRules: [{ ...stored.labRules[0], message: 'Моё сообщение {v}' }, ...stored.labRules.slice(1)] };
  const en = protocolIn(mine, 'en');
  assert.equal(en.labCadenceHint, 'Раз в месяц');
  assert.equal(en.labRules[0].message, 'Моё сообщение {v}');
  assert.match(en.labRules[1].message, /^Neutrophils/);
});

test('lab alerts come out in the user\'s language with the same severity and threshold', () => {
  const rows = [{ key: 'NEUT#', value: 0.8, unit: '×10⁹/л' }, { key: 'ALT', value: 138, unit: 'Ед/л', refHigh: 40 }, { key: 'K', value: 6, unit: 'ммоль/л' }];
  const ru = labFindings(rows, { rules: BASE_LAB_RULES });
  const en = labFindings(rows, { rules: BASE_LAB_RULES, format: EN });
  assert.deepEqual(en.map((f) => [f.key, f.severity]), ru.map((f) => [f.key, f.severity]));
  assert.equal(ru[0].message, 'Нейтрофилы 0,8 ×10⁹/л: тяжёлая нейтропения, риск инфекции. Связаться с лечащим врачом сегодня.');
  assert.equal(en[0].message, 'Neutrophils 0.8 ×10⁹/L: severe neutropenia, risk of infection. Contact the treating doctor today.');
  assert.match(en[1].message, /^ALT 138 U\/L: more than 3× the upper limit \(upper limit 40\)/);
  assert.equal(en[0].context.unit, '×10⁹/л', 'the alert keeps the stored unit');
});

test('symptom alerts in both languages', () => {
  const e = { bpSys: 165, bpDia: 95, tempC: 38.4, diarrhea: 3, handFoot: 3, nausea: 3 };
  assert.deepEqual(symptomFindings(e, '2026-09-02').map((x) => x.message), [
    'Давление 165/95: гипертония 2 степени. Если держится, нужен врач, возможна коррекция дозы.',
    'Температура 38.4 °C: на фоне терапии повод связаться с врачом сегодня.',
    'Сильная диарея: риск обезвоживания, лоперамид и вода, сообщить врачу.',
    'Выраженная реакция ладоней и стоп: обсудить с врачом снижение дозы.',
    'Сильная тошнота: обсудить противорвотные.',
  ]);
  assert.match(symptomFindings(e, '2026-09-02', 'en')[0].message, /^Blood pressure 165\/95: grade 2 hypertension/);
  for (const f of symptomFindings(e, '2026-09-02', 'en')) assert.doesNotMatch(f.message, CYRILLIC);
});

test('a stored alert follows the reader; Russian stays byte for byte, the user\'s own text stays', () => {
  const row = (message, extra = {}) => ({ id: '1', triggered_at: 'x', status: 'OPEN', context: { scope: 'LAB', key: 'TSH', severity: 'YELLOW', message, ...extra } });
  const ttg = 'ТТГ 11,4 мМЕ/л: возможный гипотиреоз (частая побочка ленватиниба), обсудить с врачом.';
  assert.equal(rowToAlert(row(ttg, { value: 11.4, unit: 'мМЕ/л' })).message, ttg);
  assert.equal(rowToAlert(row(ttg, { value: 11.4, unit: 'мМЕ/л' }), EN).message, 'TSH 11.4 mIU/L: possible hypothyroidism (a common side effect of lenvatinib), discuss with the doctor.');
  const alt = 'АЛТ 138 Ед/л: выше трёх норм (норма до 40). Возможна пауза терапии, нужен врач.';
  assert.match(rowToAlert(row(alt, { value: 138, unit: 'Ед/л', refHigh: 40 }), EN).message, /^ALT 138 U\/L: more than 3× the upper limit \(upper limit 40\)\. Treatment/);
  assert.equal(rowToAlert(row('Давление 165/95: гипертония 2 степени. Если держится, нужен врач, возможна коррекция дозы.'), EN).message, 'Blood pressure 165/95: grade 2 hypertension. If it persists, see a doctor, the dose may need adjusting.');
  assert.equal(rowToAlert(row('Глюкоза 11 ммоль/л: моя формулировка'), EN).message, 'Глюкоза 11 ммоль/л: моя формулировка');
  assert.equal(rowToAlert({ context: {} }).message, undefined);
});

test('labels the gateway keeps for its own Russian texts are the dictionary\'s', () => {
  assert.equal(kindLabels('ru').imaging, 'Контроль КТ/МРТ/ПЭТ');
  assert.equal(kindLabels('ru').other, 'Событие');
  assert.equal(responseLabels('ru').PR, 'частичный ответ');
  assert.equal(responseLabels('ru').baseline, 'исходное');
  assert.equal(responseLabels('en').PR, 'partial response');
});

test('service names: the Russian dictionary repeats lib/llmProviders.js, a service in English has no Cyrillic', () => {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    assert.equal(t('ru', `settings.aiCard.provider.${id}`), p.label);
    assert.doesNotMatch(t('en', `settings.aiCard.provider.${id}`), CYRILLIC);
  }
});

test('stored modalities and routes are codes: the Russian label of each is its stored value', () => {
  for (const m of [...MODALITIES, 'Сцинтиграфия']) assert.equal(t('ru', `imaging.modality.${modalityCode(m)}`), m);
  for (const r of ROUTES) assert.equal(t('ru', `infusions.route.${routeCode(r)}`), r);
  assert.equal(modalityLabel('КТ', 'en'), 'CT');
  assert.equal(modalityLabel('ПЭТ/МРТ', 'en'), 'ПЭТ/МРТ', 'a value we do not know stays');
  assert.equal(modalityCode('toString'), null);
  assert.equal(routeCode(null), null);
});

test('study titles: written in the language, read in the language, a typed title stays', () => {
  const s = { modality: 'КТ', region: 'ОГК', response: 'PR' };
  assert.equal(studyTitle(s, 'ru'), 'КТ ОГК: частичный ответ');
  assert.equal(studyTitle(s, 'en'), 'CT ОГК: partial response');
  assert.equal(studyTitle({ ...s, response: 'NA' }, 'en'), 'CT ОГК');
  assert.equal(milestoneTitle('imaging', 'КТ ОГК: частичный ответ', 'en'), 'CT ОГК: partial response');
  assert.equal(milestoneTitle('imaging', 'CT ОГК: partial response', 'ru'), 'КТ ОГК: частичный ответ');
  assert.equal(milestoneTitle('imaging', 'КТ ОГК: частичный ответ', 'ru'), 'КТ ОГК: частичный ответ');
  assert.equal(milestoneTitle('imaging', 'КТ: новые очаги без накопления', 'en'), 'КТ: новые очаги без накопления', 'typed by a person');
  assert.equal(milestoneTitle('surgery', 'КТ ОГК', 'en'), 'КТ ОГК');
  assert.equal(milestoneTitle('consult', 'Приём: врач', 'en'), 'Appointment: doctor');
  assert.equal(milestoneTitle('consult', 'Приём: Онколог', 'en'), 'Appointment: Онколог');
});

test('feed titles stored in Russian are written again for an English reader, patient words stay', () => {
  const en = (x) => feedText(x, 'en');
  assert.equal(en({ type: 'MILESTONE', kind: 'imaging', title: 'Контроль КТ/МРТ/ПЭТ: КТ Грудь: частичный ответ' }).title, 'CT/MRI/PET follow-up: CT Грудь: partial response');
  assert.equal(en({ type: 'MILESTONE', kind: 'surgery', title: 'Операция: Резекция' }).title, 'Surgery: Резекция');
  assert.equal(en({ type: 'MILESTONE', kind: 'consult', title: 'Консультация: Приём: Онколог' }).title, 'Consultation: Appointment: Онколог');
  assert.equal(en({ type: 'MED_ADMIN', title: 'Ленватиниб (приём 1 из 2): TAKEN', notes: 'календарь' }).title, 'Ленватиниб (dose 1 of 2): TAKEN');
  assert.equal(en({ type: 'MED_ADMIN', title: 'Ленватиниб: TAKEN', notes: 'календарь' }).notes, 'calendar');
  assert.equal(en({ type: 'NOTE', source: 'meds', title: 'Назначен Ленватиниб 24 мг' }).title, 'Started Ленватиниб 24 mg');
  assert.equal(en({ type: 'NOTE', source: 'meds', title: 'Отменён Амлодипин' }).title, 'Stopped Амлодипин');
  assert.equal(en({ type: 'NOTE', source: 'meds', title: 'Доза Ленватиниб: 24 → 20 мг' }).title, 'Dose of Ленватиниб: 24 → 20 mg');
  assert.equal(en({ type: 'NOTE', source: 'notes', title: 'Заметка: Давление' }).title, 'Note: Давление');
  const drip = en({ type: 'INFUSION', title: 'Капельница: Гептрал 400 мг', notes: 'в/в капельно · Дневной стационар · Самочувствие: хорошо' });
  assert.equal(drip.title, 'Infusion: Гептрал 400 mg');
  assert.equal(drip.notes, 'IV infusion · Дневной стационар · Wellbeing: хорошо');
  assert.equal(en({ type: 'INFUSION', title: 'Укол: Х 1 мл', notes: null }).title, 'Injection: Х 1 mL');
});

test('feed titles in Russian stay byte for byte for a Russian reader', () => {
  const rows = [
    { type: 'MILESTONE', kind: 'imaging', title: 'Контроль КТ/МРТ/ПЭТ: КТ Грудь: частичный ответ', notes: 'Очаги' },
    { type: 'MED_ADMIN', title: 'Ленватиниб (приём 1 из 2): TAKEN', notes: 'календарь' },
    { type: 'NOTE', source: 'meds', title: 'Доза Ленватиниб: 24 → 20 мг', notes: 'причина' },
    { type: 'INFUSION', title: 'Капельница: Гептрал 400 мг', notes: 'в/в капельно · Дневной стационар · Самочувствие: хорошо' },
    { type: 'NOTE', source: 'notes', title: 'Заметка: Давление', notes: null },
    { type: 'LAB_RESULT', title: 'Лабы (PDF)', notes: 'Лаб' },
  ];
  for (const r of rows) assert.deepEqual(feedText(r, 'ru'), { title: r.title, notes: r.notes });
});

test('doses: the gateway\'s own notes follow the language, a typed note does not', () => {
  assert.equal(doseNote('календарь', 'en'), 'calendar');
  assert.equal(doseNote('календарь', 'ru'), 'календарь');
  assert.equal(doseNote('назначение', 'en'), 'initial dose');
  assert.equal(doseNote('АЛТ выше трёх норм', 'en'), 'АЛТ выше трёх норм');
  assert.equal(doseNote(null, 'en'), null);
  assert.equal(kindLabel('unknown', 'en'), 'unknown');
});

test('presetText leaves a text of the user\'s own alone', () => {
  assert.equal(presetText('Моё', 'en'), 'Моё');
  assert.equal(presetText('Ленватиниб', 'en'), 'Lenvatinib');
  assert.equal(presetText('Lenvatinib', 'ru'), 'Ленватиниб');
});
