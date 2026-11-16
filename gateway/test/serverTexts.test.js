import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFormat } from '../../shared/format.js';
import { prompt, patientPrompt } from '../src/lib/aiPrompts.js';
import { imagingSystem, imagingReport } from '../src/lib/claude.js';
import { imagingJsonSchema } from '../src/lib/llm.js';
import { labsParseSchema } from '../src/lib/labsAiParse.js';
import { aiDate, aiNumber } from '../src/lib/aiFormat.js';
import { commitSummary } from '../src/lib/telegramText.js';
import { backupLine } from '../src/lib/backupStatus.js';
import { milestoneTitle } from '../src/lib/eventText.js';
import { t } from '../src/lib/i18n.js';

process.env.DATABASE_URL ||= 'postgres://unused@localhost/unused'; // imagingAi.js imports the pool; nothing here connects
const { parseSummaryText } = await import('../src/lib/imagingAi.js');

// docs/I18N.md: the texts the gateway writes by language. English is checked here, Russian must not move.
const CYRILLIC = /[А-Яа-яЁё]/;
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// sha256 of the prompts as they were in the code before they moved to locales/ru/server/aiPrompts.json
const RUSSIAN_PROMPTS = {
  base: '0359f7086cc8bbab', chat: '4658bb43cd5f31df', followUp: '2114d9bd806930bf', labs: '7a99060ab0ee27ef', monthly: 'bff9671b1b581a01', imagingComment: '30e9126de17007f8', explainSlice: 'd9e8455372bf98c2',
  notes: '4a75e2107c8bcf80', visitQuestions: 'b66d3446d3dbd58b', anamnesisDraft: '5a59b220a54a9ef4', brief: 'd9294d638d32c847', transcribe: '7f14597fb54f76b3', summarize: '899b6ac1d48f817f', labsParse: '1d60aec1cbc9ebbf', imagingParse: 'd3d8891e4a32812d',
};

test('the Russian prompts are byte for byte what they were: changing one drops the prompt cache and needs a medical read', () => {
  for (const [key, hash] of Object.entries(RUSSIAN_PROMPTS)) assert.equal(sha(prompt('ru', key)), hash, key);
});

test('a language gets its own prompt, with the base instruction first', () => {
  for (const key of ['chat', 'followUp', 'labs', 'monthly', 'imagingComment', 'explainSlice', 'notes', 'visitQuestions']) {
    assert.ok(patientPrompt('ru', key).startsWith(prompt('ru', 'base')), key);
    assert.ok(patientPrompt('en', key).startsWith(prompt('en', 'base')), key);
    assert.doesNotMatch(prompt('en', key), CYRILLIC, key);
    assert.notEqual(prompt('en', key), prompt('ru', key), key);
  }
  assert.ok(imagingSystem('en').startsWith(prompt('en', 'base')));
  assert.equal(imagingSystem('ru'), `${prompt('ru', 'base')}\n${prompt('ru', 'imagingParse')}`);
});

test('the AI answers in the language of the user', () => {
  assert.match(prompt('ru', 'base'), /Пиши по-русски/);
  assert.match(prompt('en', 'base'), /Write in English/);
  assert.match(prompt('en', 'anamnesisDraft'), /in English/);
  assert.match(prompt('en', 'summarize'), /in English/);
  assert.match(prompt('en', 'brief'), /Write in English/);
});

test('the English prompts keep the medical restrictions of the Russian ones', () => {
  const base = prompt('en', 'base');
  assert.match(base, /not a doctor/);
  assert.match(base, /do not diagnose/);
  assert.match(base, /do not prescribe or change treatment/);
  assert.match(base, /together with its date/);
  assert.match(base, /past model answers, not data/);
  assert.match(prompt('en', 'followUp'), /do not diagnose from them/);
  assert.match(prompt('en', 'followUp'), /radiologist's report/);
  assert.match(prompt('en', 'explainSlice'), /Do not diagnose anything/);
  assert.match(prompt('en', 'monthly'), /not medical advice/);
  assert.match(prompt('en', 'notes'), /not medical advice/);
  assert.match(prompt('en', 'visitQuestions'), /not medical advice/);
  assert.match(prompt('en', 'anamnesisDraft'), /Do not invent anything/);
  assert.match(prompt('en', 'imagingParse'), /Do not guess/);
});

test('English lab and imaging parsing still reads Russian reports and keeps the values as printed', () => {
  const p = prompt('en', 'labsParse');
  assert.match(p, /including Russian/);
  assert.match(p, /do not translate/);
  assert.match(p, /отрицательно/, 'a qualitative result in Russian stays in result_text');
  assert.match(prompt('en', 'imagingParse'), /положительная динамика/, 'the doctor\'s Russian wording maps to the same codes');
  const sample = { lab_name: null, doc_date: null, observations: [{ test_name_raw: 'АЛТ', result_text: '30', result_num: 30, unit_raw: 'Ед/л', ref_text_raw: null, ref_low: null, ref_high: 41, category: 'blood' }], warnings: [] };
  assert.equal(labsParseSchema('en').safeParse(sample).success, true, 'the JSON contract does not depend on the language');
  assert.deepEqual(Object.keys(imagingJsonSchema('en').properties), Object.keys(imagingJsonSchema('ru').properties));
  assert.deepEqual(Object.keys(imagingReport('en').shape), Object.keys(imagingReport('ru').shape));
  assert.doesNotMatch(JSON.stringify(imagingJsonSchema('en')), CYRILLIC);
});

test('dates and numbers for the model follow the language of the prompt, not the region', () => {
  assert.equal(aiDate('2026-03-05', 'ru'), '5 марта 2026');
  assert.equal(aiDate('2026-03-05', 'en'), 'March 5, 2026');
  assert.equal(aiNumber(5.25, 2, 'ru'), '5,25');
  assert.equal(aiNumber(5.25, 2, 'en'), '5.25');
  assert.equal(aiNumber(null, 2, 'en'), '');
});

test('bot help and the bot\'s summary of a PDF in both languages', () => {
  assert.match(t('ru', 'bot.help'), /^Я умею:/);
  assert.match(t('en', 'bot.help'), /"taken"/);
  assert.match(t('en', 'bot.help'), /pressure 135\/85, fatigue 2, weight 71/);
  assert.doesNotMatch(t('en', 'bot.help'), CYRILLIC);
  const en = commitSummary({ already: false, labName: 'Lab', docDate: '2026-02-03', inserted: 1, documentId: 'd', alertsRaised: 1, flagged: [{ name: 'ALT', value: 122, unit: 'ЕД/л', dir: 'high' }] }, 'https://x', createFormat({ language: 'en', prefs: { region: 'US' } }));
  assert.match(en, /Uploaded: Lab, February 3, 2026\./);
  assert.match(en, /1 marker, 1 out of range:/);
  assert.match(en, /↑ ALT 122 U\/L/);
  assert.match(en, /Alerts: 1/);
  assert.doesNotMatch(en, CYRILLIC);
});

test('backup line and the text of a parsed report in English', () => {
  const s = { ran_at: '2026-11-03T07:05:00Z', dump_ok: true, dump_bytes: 1048576, uploads_bytes: 0, mirror: { enabled: false }, cloud: { enabled: true, state: 'ok' }, restore_test: { state: 'failed' } };
  const line = backupLine(s, createFormat({ language: 'en', prefs: { region: 'US' }, timeZone: 'UTC' }));
  assert.match(line, /Backup Nov 3, 7:05 AM: database 1\.0 MB, files 0; second disk: off; cloud: ok; restore test: ERROR/);
  assert.equal(backupLine(null, createFormat({ language: 'en' })), 'Backup: status unknown (file not found)');
  const text = parseSummaryText({ modality: 'CT', region: 'chest', impression: 'Stable', response: 'SD', lesions: [{ name: 'S6', sizeMm: 10, prevSizeMm: 12 }], newLesions: true, warnings: ['unclear date'] }, 'en');
  assert.match(text, /Change according to the doctor's text: stable disease\./);
  assert.match(text, /S6: 10 mm, was 12 mm/);
  assert.doesNotMatch(text, CYRILLIC);
});

test('a monthly review title follows the reader, with the month', () => {
  assert.equal(milestoneTitle('ai_review', 'Оценка анализов за март 2026', 'en'), 'Lab review for March 2026');
  assert.equal(milestoneTitle('ai_review', 'Lab review for March 2026', 'ru'), 'Оценка анализов за март 2026');
  assert.equal(milestoneTitle('ai_review', 'Оценка анализов за март 2026', 'ru'), 'Оценка анализов за март 2026');
  assert.equal(milestoneTitle('ai_review', 'Моя запись', 'en'), 'Моя запись', 'a typed title stays');
});

test('the first-run code log line carries the ASCII marker and the Russian words the Russian docs grep for', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { prepareSetupCode, clearSetupCode } = await import('../src/lib/setupCode.js');
  const saved = process.env.DTC_DATA_DIR;
  process.env.DTC_DATA_DIR = mkdtempSync(`${tmpdir()}/mc-`);
  let line = '';
  const code = prepareSetupCode(true, { warn: (_o, m) => { line = m; } });
  assert.match(line, /Код первого запуска: /);
  assert.ok(line.includes(`SETUP_CODE=${code}`));
  clearSetupCode();
  process.env.DTC_DATA_DIR = saved;
  for (const f of ['errors.json', 'auth.json']) assert.match(readFileSync(new URL(`../../locales/en/${f}`, import.meta.url), 'utf8'), /grep SETUP_CODE/, f);
  assert.match(readFileSync(new URL('../../README.en.md', import.meta.url), 'utf8'), /grep SETUP_CODE/);
});

// Files that used to hold texts for people. Cyrillic stays in comments and, in the bot and the diary, in the words it understands.
const MOVED = ['routes/report.js', 'routes/labsExport.js', 'routes/export.js', 'routes/mcp.js', 'lib/dossierExport.js', 'lib/patientCard.js', 'lib/scheduler.js', 'lib/backupStatus.js', 'lib/telegramText.js',
  'lib/aiAsk.js', 'lib/anamnesisAi.js', 'lib/imagingAi.js', 'lib/labsAi.js', 'lib/labsAiParse.js', 'lib/labsMonthly.js', 'lib/notesAi.js', 'lib/appointments.js', 'lib/claude.js', 'lib/llm.js', 'lib/patientProfile.js',
  'lib/extractMethod.js', 'lib/mcpTools.js', 'lib/mcpServer.js', 'lib/notifyUser.js', 'lib/passkeys.js'];
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

test('texts for people stay in the dictionaries, not in these files', () => {
  assert.ok(readdirSync(`${SRC}lib`).length > 0);
  const bad = [];
  for (const f of MOVED) {
    readFileSync(SRC + f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '').replace(/\/\/ .*$/, '').replace(/\/\*\*.*\*\//, '');
      if (CYRILLIC.test(code)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
