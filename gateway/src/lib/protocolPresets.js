/**
 * Treatment protocol presets. `ready` = thresholds taken from a real course of treatment; `example` = a reasonable starting point written
 * from public guidance, NOT reviewed by a doctor (the UI says so). Thresholds use catalog keys only (catalogSeed.js).
 * Here is the structure: thresholds, scales, doses. The words are in locales/<language>/server/presets.json, the
 * message of a rule under `rules.<marker>_<severity>_<op>` of its preset or of `base`.
 * Message templates: {v} value, {u} unit, {ref} the reference bound the rule used.
 */
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../shared/format.js';
import { raw, has } from './i18n.js';

// Thresholds that do not depend on a drug (cytopenias, liver, kidneys, potassium).
const BASE_RULES = [
  { key: 'NEUT#', severity: 'RED', op: 'lt', value: 1.0 },
  { key: 'NEUT#', severity: 'YELLOW', op: 'lt', value: 1.5 },
  { key: 'PLT', severity: 'RED', op: 'lt', value: 75 },
  { key: 'PLT', severity: 'YELLOW', op: 'lt', value: 100 },
  { key: 'HGB', severity: 'RED', op: 'lt', value: 80 },
  { key: 'HGB', severity: 'YELLOW', op: 'lt', value: 100 },
  { key: 'ALT', severity: 'RED', op: 'gtRef', value: 3 },
  { key: 'AST', severity: 'RED', op: 'gtRef', value: 3 },
  { key: 'BIL', severity: 'YELLOW', op: 'gtRef', value: 1.5 },
  { key: 'CREA', severity: 'YELLOW', op: 'gtRef', value: 1.5 },
  { key: 'K', severity: 'YELLOW', op: 'gt', value: 5.5 },
  { key: 'K', severity: 'YELLOW', op: 'lt', value: 3.3 },
];
const base = (r) => ({ ...r, base: true });

// The order of the lists in the first-run steps and in Settings. General monitoring comes first: it fits any
// condition followed for years and is the protocol in force until another is chosen (DEFAULT_PRESET in protocol.js).
const DEFINITIONS = [
  {
    id: 'generic',
    status: 'example',
    labRules: BASE_RULES.map(base),
    diaryScales: ['fatigue', 'nausea', 'diarrhea', 'pain', 'sleepQuality', 'anxiety'],
    regimen: null,
    infusionAgents: [],
    markerNotes: [],
  },
  {
    id: 'hypothyroidism',
    status: 'example',
    labRules: [
      ...BASE_RULES.map(base),
      { key: 'TSH', severity: 'YELLOW', op: 'gt', value: 10 },
      { key: 'TSH', severity: 'YELLOW', op: 'lt', value: 0.1 },
    ],
    diaryScales: ['fatigue', 'sleepQuality', 'constipation', 'edema', 'anxiety', 'tremor'],
    regimen: { form: 'tablet', role: 'systemic', doseValue: null, timesPerDay: 1 },
    infusionAgents: [],
    markerNotes: ['TSH'],
  },
  {
    id: 'endometriosis',
    status: 'example',
    labRules: [
      ...BASE_RULES.map(base),
      { key: 'FERR', severity: 'YELLOW', op: 'lt', value: 15 },
    ],
    diaryScales: ['pain', 'fatigue', 'headache', 'nausea', 'sleepQuality', 'anxiety'],
    regimen: { form: 'tablet', role: 'systemic', doseValue: null, timesPerDay: 1 },
    infusionAgents: [
      { id: 'ferricCarboxymaltose', defaultDose: 500, sortOrder: 10 },
    ],
    markerNotes: ['HGB', 'FERR'],
  },
  {
    id: 'lenvatinib',
    status: 'ready',
    labRules: [
      ...BASE_RULES.map(base),
      { key: 'TSH', severity: 'YELLOW', op: 'gt', value: 10 },
      { key: 'U-PRO', severity: 'YELLOW', op: 'gte', value: 1 },
    ],
    diaryScales: ['fatigue', 'nausea', 'diarrhea', 'handFoot', 'throatPain', 'appetite', 'sleepQuality', 'anxiety'],
    regimen: { form: 'capsule', role: 'systemic', doseValue: 24, timesPerDay: 1 },
    infusionAgents: [
      { id: 'ivc', defaultDose: 25, sortOrder: 10 },
      { id: 'glutathione', defaultDose: 600, sortOrder: 20 },
      { id: 'heptral', defaultDose: 400, sortOrder: 30 },
    ],
    markerNotes: ['ALT', 'AST', 'CREA', 'HGB', 'WBC', 'PLT', 'NEUT#', 'TSH'],
  },
  {
    id: 'chemotherapy',
    status: 'example',
    labRules: [
      { key: 'NEUT#', severity: 'RED', op: 'lt', value: 1.0 },
      { key: 'NEUT#', severity: 'YELLOW', op: 'lt', value: 1.5 },
      { key: 'PLT', severity: 'RED', op: 'lt', value: 50 },
      { key: 'PLT', severity: 'YELLOW', op: 'lt', value: 100 },
      ...BASE_RULES.filter((r) => !['NEUT#', 'PLT'].includes(r.key)).map(base),
    ],
    diaryScales: ['fatigue', 'nausea', 'vomiting', 'diarrhea', 'constipation', 'throatPain', 'neuropathy', 'appetite', 'fever', 'sleepQuality'],
    regimen: null,
    infusionAgents: [],
    markerNotes: ['NEUT#', 'PLT', 'HGB'],
  },
  {
    id: 'immunotherapy',
    status: 'example',
    labRules: [
      { key: 'ALT', severity: 'RED', op: 'gtRef', value: 3 },
      { key: 'AST', severity: 'RED', op: 'gtRef', value: 3 },
      { key: 'BIL', severity: 'YELLOW', op: 'gtRef', value: 1.5 },
      { key: 'TSH', severity: 'YELLOW', op: 'gt', value: 4.5 },
      { key: 'TSH', severity: 'YELLOW', op: 'lt', value: 0.3 },
      { key: 'CREA', severity: 'YELLOW', op: 'gtRef', value: 1.5 },
      { key: 'GLU', severity: 'RED', op: 'gt', value: 13.9 },
      { key: 'GLU', severity: 'YELLOW', op: 'gt', value: 7.8 },
      { key: 'NA', severity: 'YELLOW', op: 'lt', value: 132 },
    ],
    diaryScales: ['fatigue', 'diarrhea', 'rash', 'itch', 'cough', 'dyspnea', 'jointPain', 'headache', 'appetite'],
    regimen: null,
    infusionAgents: [],
    markerNotes: ['TSH', 'ALT', 'GLU'],
  },
  {
    id: 'kidney-transplant',
    status: 'example',
    labRules: [
      { key: 'CREA', severity: 'YELLOW', op: 'gtRef', value: 1.2 },
      { key: 'K', severity: 'RED', op: 'gt', value: 6.0 },
      { key: 'K', severity: 'YELLOW', op: 'gt', value: 5.5 },
      { key: 'MG', severity: 'YELLOW', op: 'lt', value: 0.66 },
      { key: 'GLU', severity: 'YELLOW', op: 'gt', value: 7.8 },
      { key: 'WBC', severity: 'YELLOW', op: 'lt', value: 3.0 },
      { key: 'HGB', severity: 'YELLOW', op: 'lt', value: 100 },
      { key: 'U-PRO', severity: 'YELLOW', op: 'gte', value: 0.3 },
      { key: 'TAC', severity: 'YELLOW', op: 'gt', value: 15 },
      { key: 'TAC', severity: 'YELLOW', op: 'lt', value: 4 },
    ],
    diaryScales: ['tremor', 'edema', 'fatigue', 'diarrhea', 'headache', 'fever', 'sleepQuality', 'anxiety'],
    regimen: null,
    infusionAgents: [],
    markerNotes: ['CREA', 'K', 'TAC'],
  },
  {
    id: 'hemodialysis',
    status: 'example',
    labRules: [
      { key: 'K', severity: 'RED', op: 'gt', value: 6.0 },
      { key: 'K', severity: 'YELLOW', op: 'gt', value: 5.5 },
      { key: 'HGB', severity: 'RED', op: 'lt', value: 80 },
      { key: 'HGB', severity: 'YELLOW', op: 'lt', value: 100 },
      { key: 'CA', severity: 'YELLOW', op: 'lt', value: 2.1 },
      { key: 'CA', severity: 'YELLOW', op: 'gt', value: 2.6 },
      { key: 'NA', severity: 'YELLOW', op: 'lt', value: 132 },
    ],
    diaryScales: ['edema', 'dyspnea', 'cramps', 'itch', 'fatigue', 'appetite', 'dizziness', 'sleepQuality'],
    regimen: null,
    infusionAgents: [],
    markerNotes: ['K', 'CREA'],
  },
  {
    id: 'methotrexate',
    status: 'example',
    labRules: [
      { key: 'ALT', severity: 'RED', op: 'gtRef', value: 3 },
      { key: 'ALT', severity: 'YELLOW', op: 'gtRef', value: 2 },
      { key: 'AST', severity: 'YELLOW', op: 'gtRef', value: 2 },
      { key: 'WBC', severity: 'RED', op: 'lt', value: 3.0 },
      { key: 'WBC', severity: 'YELLOW', op: 'lt', value: 3.5 },
      { key: 'NEUT#', severity: 'YELLOW', op: 'lt', value: 1.5 },
      { key: 'PLT', severity: 'YELLOW', op: 'lt', value: 100 },
      { key: 'CREA', severity: 'YELLOW', op: 'gtRef', value: 1.3 },
      { key: 'HGB', severity: 'YELLOW', op: 'lt', value: 100 },
    ],
    diaryScales: ['jointPain', 'stiffness', 'fatigue', 'nausea', 'throatPain', 'cough', 'dyspnea', 'rash'],
    // Weekly: the weekday defaults to the start date's; change it in «Препараты» after creating the regimen.
    regimen: { form: 'tablet', role: 'systemic', doseValue: null, timesPerDay: 1, frequencyRule: 'WEEKLY', scheduleDays: [] },
    infusionAgents: [],
    markerNotes: ['ALT', 'WBC'],
  },
];

/** A preset with its texts in `language`. */
function build(d, language) {
  const text = (key) => raw(language, `presets.${d.id}.${key}`);
  const optional = (key) => (has(language, `presets.${d.id}.${key}`) ? text(key) : '');
  const message = ({ base: shared, key, severity, op }) => raw(language, `presets.${shared ? 'base' : d.id}.rules.${key}_${severity}_${op}`);
  return {
    id: d.id,
    name: text('name'),
    status: d.status,
    summary: text('summary'),
    aiNotes: optional('aiNotes'),
    labCadenceHint: optional('labCadenceHint'),
    labRules: d.labRules.map((r) => ({ key: r.key, severity: r.severity, op: r.op, value: r.value, message: message(r) })),
    diaryScales: d.diaryScales,
    regimen: d.regimen && { ...d.regimen, name: text('regimen.name'), doseUnit: text('regimen.doseUnit'), instructions: text('regimen.instructions') },
    infusionAgents: d.infusionAgents.map(({ id, defaultDose, sortOrder }) => ({
      name: text(`agents.${id}.name`), shortName: text(`agents.${id}.shortName`), defaultDose, doseUnit: text(`agents.${id}.doseUnit`), sortOrder, notes: text(`agents.${id}.notes`),
    })),
    markerNotes: Object.fromEntries(d.markerNotes.map((k) => [k, text(`markerNotes.${k}`)])),
  };
}

const byLanguage = new Map();
/** Every preset with its texts in `language`. */
export function presetsIn(language) {
  if (!byLanguage.has(language)) byLanguage.set(language, DEFINITIONS.map((d) => build(d, language)));
  return byLanguage.get(language);
}

/** Stored protocols keep preset texts in Russian (protocol.js, protocolIn), so this is the list the protocol code works with. */
export const PRESETS = presetsIn(DEFAULT_LANGUAGE);
export const BASE_LAB_RULES = BASE_RULES.map((r) => ({ ...r, message: raw(DEFAULT_LANGUAGE, `presets.base.rules.${r.key}_${r.severity}_${r.op}`) }));

/** Dictionary keys of every rule message, for recognizing a message stored in another language (lib/i18n.js, relocalize). */
export const presetRuleKeys = () => DEFINITIONS.flatMap((d) => d.labRules.map(({ base: shared, key, severity, op }) => `presets.${shared ? 'base' : d.id}.rules.${key}_${severity}_${op}`));

let texts = null;
/** The texts of a preset in a fixed order, so that the lists of two languages run in parallel. */
function textsOf(p) {
  return [
    p.name, p.summary, p.aiNotes, p.labCadenceHint, ...p.labRules.map((r) => r.message),
    p.regimen?.name, p.regimen?.doseUnit, p.regimen?.instructions,
    ...p.infusionAgents.flatMap((a) => [a.name, a.shortName, a.doseUnit, a.notes]),
    ...Object.values(p.markerNotes),
  ];
}
/** text in any language → { ru, en, … } */
function allTexts() {
  if (texts) return texts;
  texts = new Map();
  const lists = LANGUAGES.map((l) => presetsIn(l).flatMap(textsOf));
  lists[0].forEach((_, i) => {
    const variants = Object.fromEntries(LANGUAGES.map((l, n) => [l, lists[n][i]]));
    for (const l of LANGUAGES) if (variants[l]) texts.set(variants[l], variants);
  });
  return texts;
}

// Preset texts reworded after a release, the old Russian text → its dictionary key. A protocol stored with the old
// words (protocol.js keeps preset texts in the settings) still counts as its preset and follows the reader's language.
const RETIRED_TEXTS = {
  'Без привязки к препарату: только базовые пороги по крови, печени, почкам и калию. Пример, не проверен врачом.': 'presets.generic.summary',
};
/** A preset text as it is worded now; any other text comes back as it is. */
export const currentPresetText = (text) => (RETIRED_TEXTS[text] ? raw(DEFAULT_LANGUAGE, RETIRED_TEXTS[text]) : text);

/** A preset text in `language`; any other text (the user's own) comes back as it is. */
export const presetText = (text, language) => allTexts().get(text)?.[language] ?? text;
/** The same preset text in every language; a text of the user's own, on its own. */
export const presetVariants = (text) => { const v = allTexts().get(text); return v ? Object.values(v) : [text]; };
