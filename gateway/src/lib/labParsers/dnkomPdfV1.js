/**
 * Port of ingestion/app/connectors/dnkom_pdf_v1.py (DNKOM: a table per panel, the unit glued to the reference and
 * sometimes wrapped to the next line, tables running over page breaks, the leukocyte formula named by its unit). Keep
 * the two in step; the shared fixtures and their .expected.json check it.
 */
import { pyFloat, ruDateIso, split, splitlines } from './py.js';

const N = '[0-9]+(?:[.,][0-9]+)?';
const RES = `[<>≤≥]? ?${N}`;
const REF = `${N} ?- ?${N}|[<>≤≥] ?${N}`;
const ROW = new RegExp(`^(?<name>.+?) (?<res>${RES}) (?<ref>${REF})(?<unit>.*)$`);
// «10^9/л» glued to a reference that ends in digits: cut it off first, or it reads as part of the number
const POWER = /10\^[0-9]+\/\S+$/;
const UNIT_TAIL = /^[а-яё]+$/;
const FORMULA = /^(Нейтрофилы|Эозинофилы|Базофилы|Моноциты|Лимфоциты|Незрелые гранулоциты|Нормобласты) \(.+\)$/;
const HEADER = 'Показатель Результат';
const TABLE_END = ['Комментарии к пробе', 'Примечание', 'Исследования выполнены', 'Результаты одобрил'];

export const META = {
  id: 'dnkom_pdf_v1',
  name: 'ДНКОМ',
  country: 'RU',
  description: 'Бланки лаборатории ДНКОМ: кровь, биохимия, гормоны, онкомаркеры, аутоантитела.',
  fallback: false,
};

const toFloat = (s) => pyFloat((s || '').replace(/,/g, '.'));

function refBounds(ref) {
  let m = new RegExp(`^(${N}) ?- ?(${N})$`).exec(ref);
  if (m) return [toFloat(m[1]), toFloat(m[2])];
  m = new RegExp(`^[<≤] ?(${N})$`).exec(ref);
  if (m) return [null, toFloat(m[1])];
  m = new RegExp(`^[>≥] ?(${N})$`).exec(ref);
  if (m) return [toFloat(m[1]), null];
  return [null, null];
}

function name(raw, unit) {
  const n = raw.replace(/[* ]+$/, '');
  const m = FORMULA.exec(n);
  if (!m) return n;
  return unit === '%' ? `${m[1]}, %` : `${m[1]}, абс.`;
}

function rows(text) {
  const out = [];
  let inTable = false;
  let last = null;
  for (const raw of splitlines(text)) {
    const line = split(raw).join(' ');
    if (!line) continue;
    if (line.startsWith(HEADER)) { inTable = true; last = null; continue; }
    if (TABLE_END.some((t) => line.startsWith(t))) { inTable = false; last = null; continue; }
    if (!inTable) continue;
    if (last && UNIT_TAIL.test(line)) {
      last.units = last.units ? `${last.units} ${line}` : line;
      last = null;
      continue;
    }
    const power = POWER.exec(line);
    const m = ROW.exec(power ? line.slice(0, power.index) : line);
    if (!m) { last = null; continue; }
    const [low, high] = refBounds(m.groups.ref);
    const unit = (power ? power[0] : m.groups.unit.trim()) || null;
    last = {
      test_name: name(m.groups.name, unit),
      result_text: m.groups.res,
      result_num: toFloat(m.groups.res),
      units: unit,
      ref_text: m.groups.ref,
      ref_low: low,
      ref_high: high,
    };
    out.push(last);
  }
  return out;
}

export const detect = (text) => text.includes('ДНКОМ') && text.includes(HEADER);

export function parseText(text) {
  const t = String(text);
  let docDate = null;
  const dm = /(?:Взятие|Регистрация) биоматериала: ?([0-9]{2}\.[0-9]{2}\.[0-9]{4})/.exec(t);
  if (dm) { try { docDate = ruDateIso(dm[1]); } catch { docDate = null; } }
  return { lab_name: 'ДНКОМ', doc_date: docDate, observations: rows(t) };
}
