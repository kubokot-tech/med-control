/**
 * Diary scales (0–3: нет / слабо / умеренно / сильно). The treatment protocol picks which ones the diary shows
 * (protocol.diaryScales); every scale stays readable in history and reports once it has values.
 * The first nine have their own columns in symptom_entries (older data lives there); the rest are stored in the
 * jsonb column symptom_entries.scales. Pure module: no database. Label, short label and hint of a scale are in
 * locales/<language>/server/scales.json.
 */
import { DEFAULT_LANGUAGE } from '../../../shared/format.js';
import { raw, has } from './i18n.js';

const scaleText = (key, language) => ({
  label: raw(language, `scales.${key}.label`),
  short: raw(language, `scales.${key}.short`),
  hint: has(language, `scales.${key}.hint`) ? raw(language, `scales.${key}.hint`) : '',
});

// words: regexp fragments for the one-line Telegram diary (see symptomsText.js), W = any letters, B/E = word edges.
const SCALES = [
  { key: 'fatigue', column: 'fatigue', words: 'усталост|слабост|устал|fatigue|tired|weakness|exhaust' },
  { key: 'nausea', column: 'nausea', words: 'тошн|nause' },
  { key: 'diarrhea', column: 'diarrhea', words: 'диаре|понос|жидкW стул|diarrh|loose stool' },
  { key: 'handFoot', column: 'hand_foot', words: 'ладон|ладош|подошв|Bстоп|hand.foot|Bpalms?E|Bsoles?E' },
  { key: 'throatPain', column: 'throat_pain', words: 'горл|стоматит|язвочк|BртE|Bво ртуE|throat|stomatitis|mucositis|mouth sore|mouth ulcer' },
  { key: 'jawEarPain', column: 'jaw_ear_pain', words: 'челюст|Bух[оа]E|Bуши|Bухе|BjawE|Bears?E|earache' },
  { key: 'reflux', column: 'reflux', words: 'изжог|рефлюкс|отрыжк|heartburn|reflux|belching|burping' },
  { key: 'sleepQuality', column: 'sleep_quality', words: 'BсонE|спал|BснаE|бессонниц|Bsleep|Bslept|insomnia' },
  { key: 'anxiety', column: 'anxiety', words: 'тревог|тревож|настроен|паник|anxi|panic|Bmood|worried' },
  // jsonb-backed
  { key: 'appetite', words: 'аппетит|appetite' },
  { key: 'vomiting', words: 'рвот|вырвал|стошнил|vomit|threw up|throwing up' },
  { key: 'constipation', words: 'запор|constipat' },
  { key: 'neuropathy', words: 'онемен|покалыв|нейропат|немеют|Bnumb|tingl|neuropath|pins and needles' },
  { key: 'rash', words: 'сып|высыпан|акне|BrashE|acne|hives' },
  { key: 'itch', words: 'зуд|чешет|чеса|itch' },
  { key: 'cough', words: 'кашл|кашел|cough' },
  { key: 'dyspnea', words: 'одышк|задыха|не хватает воздуха|dyspn|short of breath|shortness of breath|breathless|out of breath' },
  { key: 'edema', words: 'от[её]к|edema|oedema|swelling|swollen' },
  { key: 'jointPain', words: 'сустав|Bjoints?E|arthralg' },
  { key: 'stiffness', words: 'скованн|stiff' },
  { key: 'pain', words: 'BбольE|BболиE|болит|болел|BpainW|Bhurts?E|Baches?E|Baching' },
  { key: 'headache', words: 'голов[а-я]* бол|бол[а-я]* голов|мигрен|headache|head pain|head hurts|migraine' },
  { key: 'dizziness', words: 'головокруж|кружится|dizz|lightheaded|light.headed|vertigo' },
  { key: 'tremor', words: 'тремор|дрож|tremor|trembl|shaking|shaky' },
  { key: 'cramps', words: 'судорог|сводит|cramp|spasm' },
  { key: 'bleeding', words: 'кровоточ|кровь из носа|синяк|bleed|bruis' },
  { key: 'fever', words: 'озноб|знобит|лихорад|chills|shiver|Bfever' },
];

/** The catalog with the Russian labels, the source language; `words` hold both languages (symptomsText.js). */
export const SCALE_CATALOG = SCALES.map((s) => ({ ...s, ...scaleText(s.key, DEFAULT_LANGUAGE) }));

export const SCALE_KEYS = SCALE_CATALOG.map((s) => s.key);
export const SCALE_BY_KEY = new Map(SCALE_CATALOG.map((s) => [s.key, s]));
/** camelCase key → column for the scales that have their own column. */
export const SCALE_COLUMNS = Object.fromEntries(SCALE_CATALOG.filter((s) => s.column).map((s) => [s.key, s.column]));
export const JSONB_SCALE_KEYS = SCALE_CATALOG.filter((s) => !s.column).map((s) => s.key);
/** Shown when a protocol has no list of its own. */
export const DEFAULT_SCALES = ['fatigue', 'nausea', 'diarrhea', 'pain', 'sleepQuality', 'anxiety'];

/** Short label for summaries («усталость 2 · одышка 3»). */
export const scaleShort = (key, language = DEFAULT_LANGUAGE) => (SCALE_BY_KEY.has(key) ? scaleText(key, language).short : key);

/** Keys of the scales that have a value in this entry, in catalog order. */
export function scalesWithValues(entry, min = 0) {
  return SCALE_KEYS.filter((k) => entry?.[k] != null && entry[k] >= min);
}

/** Public shape for the frontend (no regexps). */
export function scaleCatalog(language = DEFAULT_LANGUAGE) {
  return SCALES.map(({ key }) => { const { label, hint } = scaleText(key, language); return { key, label, hint }; });
}
