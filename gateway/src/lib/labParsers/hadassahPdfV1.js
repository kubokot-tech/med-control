/**
 * Port of ingestion/app/connectors/hadassah_pdf_v1.py (Hadassah Medical Moscow, two layouts: the «Наименование
 * Результат Референсное значение» table with names wrapped over several lines and the unit glued to the reference, and
 * the «Результаты лабораторных исследований» list with a row per line). Keep the two in step; the shared fixtures check it.
 */
import { strip, split, splitlines, pyFloat, ruDateIso } from './py.js';

const N = '[0-9]+(?:[.,][0-9]+)?';
const RES = `[<>≤≥]?${N}`;
const RANGE = `${N} ?- ?${N}`;
// qualitative results: detection, sign, clarity, colour, Rh phenotype, ABO group
const QUAL = '(?:не )?(?:обнаружен[аоы]?|выявлен[аоы]?)|(?:слабо)?(?:отрицательн|положительн)(?:о|ый|ая|ое|ые)'
  + '|сомнительн(?:о|ый|ая|ое)|прозрачн(?:ая|ый|ое)|(?:слабо |слегка )?мутн(?:ая|ый|ое)'
  + '|(?:[а-яё]+-)?(?:желт|оранжев|красн|бур|коричнев|зелен|бесцветн|розов|янтарн)[а-яё]*|следы|\\+{1,4}'
  + '|[c]{2}d{0,2}e{2}|(?:0|o|a|b|ab) ?\\((?:i|ii|iii|iv)\\)';
// name (may be empty: it was on the previous lines), result, reference (range or bound), unit glued to the reference
const ROW = new RegExp(`^(?:(?<name>.*\\S) )?(?<res>${RES}) (?<ref>${RANGE}|[<>≤≥] ?${N}|до ${N})(?<unit> ?[^0-9 ].*)?$`);
// a single number as the reference («Нормобласты 0,00 0*109 кл/л») only counts with a unit after it
const ROW_ONE = new RegExp(`^(?:(?<name>.*\\S) )?(?<res>${RES}) (?<ref>${N})(?<unit> ?[^0-9 .,].*)$`);
// leukocyte formula: absolute value and range, relative value and range
const FORMULA = new RegExp(`^(?<name>.*\\S) (?<abs>${N}) (?<absref>${RANGE}) (?<pct>${N}) (?<pctref>${RANGE})$`);
// qualitative row: «Kell антиген (К) Отрицательный», optionally the expected value after it
const QROW = new RegExp(`^(?:(?<name>.*?\\S) )?(?<res>${QUAL})(?: (?<ref>${QUAL}))?$`, 'i');

// list layout: the reference is a range, a bound, a number or a text («Не нормировано», «Не обнаружено», a colour list)
const L_REF = `${RANGE}|[<>≤≥] ?${N}|до ${N}|${N}|не нормировано|(?:${QUAL})(?:,.*)?`;
const L_NUM = new RegExp(`^(?<name>.+?) (?<res>[<>≤≥]? ?${N}) (?:(?<unit>\\*10\\^?[0-9]+ \\S+|[^\\s0-9<>≤≥]\\S*) )?(?<ref>${L_REF})$`, 'i');
const L_TXT = new RegExp(`^(?<name>.+?) (?<res>${QUAL})(?: (?<unit>[^\\s()]*/[^\\s()]*|-))? (?<ref>${L_REF})$`, 'i');
// a row cut short: name and result, maybe the first word of the unit, the rest on the next lines
const L_PARTIAL = new RegExp(`^.+? [<>≤≥]? ?${N}(?: \\S+)?$`);

const POWER = /^\*10\^?([0-9]{1,2}) ?кл\/(л|мл|мкл)$/;

const toFloat = (s) => pyFloat((s || '').replace(/,/g, '.'));

function refBounds(ref) {
  const r = ref || '';
  let m = new RegExp(`^(${N}) ?- ?(${N})$`).exec(r);
  if (m) return [toFloat(m[1]), toFloat(m[2])];
  m = new RegExp(`^(?:[<≤]|до) ?(${N})$`).exec(r);
  if (m) return [null, toFloat(m[1])];
  m = new RegExp(`^[>≥] ?(${N})$`).exec(r);
  if (m) return [toFloat(m[1]), null];
  return [null, null];
}

function unit(raw) {
  const u = strip(raw || '');
  const m = POWER.exec(u);
  if (m) return `10^${m[1]}/${m[2]}`;
  return u === '' || u === '-' ? null : u;
}

function obs(name, res, ref, units) {
  const [low, high] = refBounds(ref);
  return { test_name: name, result_text: res, result_num: toFloat(res), units, ref_text: ref ?? null, ref_low: low, ref_high: high };
}

const clean = (raw) => split(raw.replace(/[↑↓]/g, ' ')).join(' ');

/** Lines that end a name being collected: table headers, «Ключ: значение» header lines, the page footer. */
const endsName = (line) => line.includes(':') || line.startsWith('Наименование') || line.includes('История результата')
  || line.startsWith('Филиал компании') || line.endsWith('.') || line.endsWith(',') || /^[0-9]+ из [0-9]+$/.test(line);

function parseTable(text) {
  const observations = [];
  let pending = [];
  for (const raw of splitlines(text)) {
    const line = clean(raw);
    if (!line) continue;
    const f = FORMULA.exec(line);
    if (f) {
      const name = [...pending, f.groups.name].join(' ');
      observations.push(obs(`${name}, абс.`, f.groups.abs, f.groups.absref, '10^9/л'));
      observations.push(obs(`${name}, %`, f.groups.pct, f.groups.pctref, '%'));
      pending = [];
      continue;
    }
    const r = line.includes(':') ? null : (ROW.exec(line) || ROW_ONE.exec(line) || QROW.exec(line));
    if (r) {
      const name = [...pending, ...(r.groups.name ? [r.groups.name] : [])].join(' ');
      if (name) observations.push(obs(name, r.groups.res, r.groups.ref, unit(r.groups.unit)));
      pending = [];
      continue;
    }
    pending = endsName(line) ? [] : [...pending, line].slice(-4);
  }
  return observations;
}

function parseList(text) {
  const lines = splitlines(text).map(clean);
  const h = lines.findIndex((x) => x.startsWith('Результаты лабораторных исследований'));
  const observations = [];
  let section = '';
  let i = h < 0 ? lines.length : h + 1;
  while (i < lines.length) {
    let line = lines[i];
    i += 1;
    if (!line || line.includes(':')) continue;
    // a reference list that goes on: «соломенно-желтый,» / «желтый, светло-» / «желтый»
    while ((line.endsWith(',') || line.endsWith('-')) && i < lines.length && lines[i] && !lines[i].includes(':')) {
      line = line.endsWith('-') ? line + lines[i] : `${line} ${lines[i]}`;
      i += 1;
    }
    let m = L_NUM.exec(line) || L_TXT.exec(line);
    if (!m && L_PARTIAL.test(line)) {
      for (const k of [1, 2]) {
        const next = lines.slice(i, i + k);
        if (i + k > lines.length || next.some((x) => !x || x.includes(':'))) break;
        m = L_NUM.exec([line, ...next].join(' '));
        if (m) { i += k; break; }
      }
    }
    if (!m) { section = line; continue; }
    let name = m.groups.name;
    if (section.toLowerCase().includes('моч') && !name.toLowerCase().includes('моч')) name = `${name} (моча)`;
    observations.push(obs(name, m.groups.res, m.groups.ref, unit(m.groups.unit)));
  }
  return observations;
}

export const META = {
  id: 'hadassah_pdf_v1',
  name: 'Хадасса Медикал (Москва)',
  country: 'RU',
  description: 'Бланки клинико-диагностической лаборатории: кровь, коагулограмма, иммуногематология, биохимия, общий анализ мочи. Таблица «Наименование / Результат / Референсное значение» и список «Результаты лабораторных исследований»',
  fallback: false,
};

export const detect = (text) => text.includes('Хадасса')
  && (text.includes('Наименование Результат') || text.includes('Результаты лабораторных исследований'));

export function parseText(text) {
  const t = String(text);
  let docDate = null;
  const dm = /(?:Дата взятия образца|Дата\/время забора): ?([0-9]{2}\.[0-9]{2}\.[0-9]{4})/.exec(t);
  if (dm) { try { docDate = ruDateIso(dm[1]); } catch { docDate = null; } }
  const observations = t.includes('Наименование Результат') ? parseTable(t) : parseList(t);
  return { lab_name: 'Хадасса', doc_date: docDate, observations };
}
