/**
 * One-line diary from Telegram: «давление 135/85, усталость 2, вес 71, темп 37.1, самочувствие 4, сон плохо» or
 * "pressure 135/85, fatigue 2, weight 71, temp 37.1, wellbeing 4, sleep bad". Both languages work whatever the setting.
 * A number without a unit is in the user's units, a written unit (kg, lb, °F) wins; the entry always holds kg and °C.
 * Pure parser: returns { entry, recognized, unknown, yesterday } or null when nothing looks like a diary line.
 */
import { SCALE_CATALOG, SCALE_BY_KEY } from './diaryScales.js';
import { bodyUnits } from '../../../shared/units.js';

// JS word boundaries and \\w do not know Cyrillic: boundaries are spelled out (B/E) and W = letters.
const B = '(?<![а-яa-z0-9])', E = '(?![а-яa-z0-9])', L = '[а-яa-z]*';
const rx = (s) => new RegExp(s.replaceAll('W', L).replaceAll('B', B).replaceAll('E', E));
// Specific scales first: «болит голова» is a headache and «боль в горле» the throat, not generic pain.
const SCALES = [...SCALE_CATALOG.filter((x) => x.key !== 'pain'), SCALE_BY_KEY.get('pain')].map((x) => [x.key, rx(x.words)]);
// the first match wins: «not good» has to come before «good»
const WORDS = [[rx('Bnot (so |very )?(good|great|well|ok|okay|fine)E'), 2],
  [rx('B(нет|ноль|нормW|хорошW|отличнW|ок|no|none|zero|normal|fine|good|great|well|ok|okay)E'), 0],
  [rx('B(чуть|слегка|немного|слабо|легкW|небольшW|slight|slightly|mild|mildly|little|a bit|light|lightly|weak)E'), 1],
  [rx('B(умереннW|среднW|заметнW|плохо|так себе|moderate|moderately|medium|noticeable|bad|badly|poor|poorly|so.so)E'), 2],
  [rx('B(сильнW|очень|ужаснW|тяжелW|невыносимW|бессонницW|severe|severely|strong|strongly|very|terrible|awful|extreme|unbearable|insomnia)E'), 3]];

const num = (s) => Number(String(s).replace(',', '.'));
function scaleValue(part) {
  const m = /(?:^|\D)([0-3])(?:\s*(?:из|of|out of|\/)\s*3)?(?:\D|$)/.exec(part.replace(/\d{2,}/g, ' '));
  if (m) return Number(m[1]);
  for (const [rx, v] of WORDS) if (rx.test(part)) return v;
  return 2; // keyword named without a level: notable enough to mention
}

/** `units`: { temperature: 'c' | 'f', weight: 'kg' | 'lb' }, what a number without a unit means. */
export function parseSymptomsText(text, units = {}) {
  let t = String(text || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/(\d),(\d)/g, '$1.$2');
  if (!t || t.length > 500) return null;
  const yesterday = /^(вчера|yesterday)(?![а-яa-z])/.test(t);
  t = t.replace(/^(вчера|сегодня|yesterday|today)(?![а-яa-z])[\s:,-]*/, '');
  const inLb = bodyUnits({ weight: 'lb' }).weightIn; const inF = bodyUnits({ temperature: 'f' }).temperatureIn;
  const entry = {}; const recognized = []; const unknown = []; const notes = [];
  for (let part of t.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    let hit = false;
    const note = /^(заметк[аи]|коммент[а-я]*|прим[а-я]*|notes?|comment)\s*[:\-]?\s*(.+)$/.exec(part);
    if (note) { notes.push(note[2]); continue; }
    const bp = /(?:давлен[а-я]*|ад|bp|blood pressure|pressure)?\s*(\d{2,3})\s*(?:\/|на|over|-)\s*(\d{2,3})(?!\d)/.exec(part);
    if (bp && /давлен|(?<![а-я])ад(?![а-я])|bp|pressure|\//.test(part)) { entry.bpSys = Number(bp[1]); entry.bpDia = Number(bp[2]); recognized.push('bp'); hit = true; part = part.replace(bp[0], ' '); }
    const w = /(?:вес[а-я]*|weight)\s*[:\-]?\s*(\d{2,3}(?:[.,]\d)?)\s*(kg|кг|lbs?|pounds?|фунт[а-я]*)?|(\d{2,3}(?:[.,]\d)?)\s*(kg|кг|lbs?|pounds?|фунт[а-я]*)(?![а-яa-z])/.exec(part);
    if (w) {
      const unit = w[2] || w[4] || (units.weight === 'lb' ? 'lb' : 'kg');
      entry.weightKg = /^(lb|pound|фунт)/.test(unit) ? inLb(num(w[1] || w[3])) : num(w[1] || w[3]);
      recognized.push('weightKg'); hit = true; part = part.replace(w[0], ' ');
    }
    // Fahrenheit first: a written °F, or a word and a number when the user's unit is °F
    const tf = /(?:темп[а-я]*|temp[a-z]*|(?<![а-яa-z])t)?\s*[:\-]?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:°\s*f|f(?![а-яa-z])|deg f|degrees f)/.exec(part)
      || (units.temperature === 'f' ? /(?:темп[а-я]*|temp[a-z]*|(?<![а-яa-z])t)\s*[:\-]?\s*(9\d(?:[.,]\d)?|1[01]\d(?:[.,]\d)?)/.exec(part) : null);
    const tp = tf ? null : /(?:темп[а-я]*|temp[a-z]*|(?<![а-яa-z])t|температур[а-я]*)\s*[:\-]?\s*(3\d(?:[.,]\d)?|4[0-2](?:[.,]\d)?)|(3[5-9][.,]\d|4[0-2][.,]\d)\s*°?\s*c?/.exec(part);
    if (tf) { entry.tempC = inF(num(tf[1])); recognized.push('tempC'); hit = true; part = part.replace(tf[0], ' '); }
    if (tp) { entry.tempC = num(tp[1] || tp[2]); recognized.push('tempC'); hit = true; part = part.replace(tp[0], ' '); }
    const pu = /(?:пульс[а-я]*|чсс|hr|pulse|heart rate)\s*[:\-]?\s*(\d{2,3})/.exec(part);
    if (pu) { entry.pulse = Number(pu[1]); recognized.push('pulse'); hit = true; part = part.replace(pu[0], ' '); }
    const st = /(?:шаг[а-я]*|steps)\s*[:\-]?\s*(\d{2,6})|(\d{3,6})\s*(?:шаг|steps)/.exec(part);
    if (st) { entry.steps = Number(st[1] || st[2]); recognized.push('steps'); hit = true; part = part.replace(st[0], ' '); }
    const wb = /(?:самочувств[а-я]*|общее|состояни[а-я]*|well.?being|feeling)\s*[:\-]?\s*([1-5])(?:\s*(?:из|of|out of|\/)\s*5)?/.exec(part);
    if (wb) { entry.wellbeing = Number(wb[1]); recognized.push('wellbeing'); hit = true; part = part.replace(wb[0], ' '); }
    for (const [key, rx] of SCALES) {
      if (!rx.test(part)) continue;
      entry[key] = scaleValue(part); recognized.push(key); hit = true; break;
    }
    if (!hit && part.trim()) unknown.push(part.trim());
  }
  if (!recognized.length) return null;
  if (notes.length || unknown.length) entry.notes = [...notes, ...unknown].join('; ');
  return { entry, recognized, unknown, yesterday };
}
