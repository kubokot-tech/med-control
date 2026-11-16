/**
 * Port of ingestion/app/connectors/mknc_pdf_v1.py and its vendor/labs_parse_pdf.py (MKNC laboratory reports: one
 * cell per line under a «Тест» header). Keep the two in step; the shared fixtures check it.
 */
import { strip, splitlines, pyFloat, ruDateIso, WORD_END } from './py.js';

const NUM = /^[-+]?\d+[.,]?\d*$/;
const UNIT = /(ммоль\/л|мМоль\/л|мкмоль\/л|г\/л|г\/дл|мг\/дл|мг\/л|мкг\/л|ЕД\/л|ед\/л|единицы\s*рН|отн\.ед\.|фл|пг|%|10\^\d+\/л|×\s*10\^\d+\/л|количество\/мкл)/i;
const HEADER_LIKE = new Set(['Результат', 'Норма', 'Отклонение', 'Критичность', 'отклонения', 'Ед. изм.', 'Ед.', 'изм.']);
const NOT_A_NAME = new Set(['-', 'Тест', 'Результат', 'Норма', 'Отклонение', 'Критичность']);
const STATUS_TAIL = `(?:\\s+отклонение${WORD_END}|\\s+ненормальный${WORD_END}|$)`;

const toFloat = (s) => { const t = strip(s).replace(/ /g, ''); return t ? pyFloat(t.replace(/,/g, '.')) : null; };

function parseRefRange(ref) {
  if (!ref) return [null, null];
  const m = /^\s*([-+]?\d+[.,]?\d*)\s*-\s*([-+]?\d+[.,]?\d*)\s*$/.exec(ref);
  return m ? [toFloat(m[1]), toFloat(m[2])] : [null, null];
}

const obs = (o) => ({ test_name: o.test_name, result_text: o.result_text ?? null, result_num: o.result_num ?? null, ref_text: o.ref_text ?? null, ref_low: o.ref_low ?? null, ref_high: o.ref_high ?? null, deviation_text: o.deviation_text ?? null, criticality_text: o.criticality_text ?? null, units: o.units ?? null });
const qualitative = (name, value) => obs({ test_name: name, result_text: value });

function parseTable(lines) {
  const isStartOfTest = (idx) => {
    if (idx < 0 || idx >= lines.length - 1) return false;
    const a = lines[idx]; const b = lines[idx + 1];
    if (!a || NOT_A_NAME.has(a)) return false;
    if (a.startsWith('Исполнитель')) return false;
    return !NUM.test(a) && NUM.test(b);
  };
  const h = lines.indexOf('Тест');
  if (h === -1) return [];
  let i = h + 1;
  while (i < lines.length && HEADER_LIKE.has(lines[i])) i++;

  const out = [];
  while (i < lines.length) {
    if (lines[i].startsWith('Исполнитель')) break;
    const nameParts = [];
    while (i < lines.length && !NUM.test(lines[i])) {
      if (lines[i].startsWith('Исполнитель')) break;
      if (UNIT.test(lines[i]) && isStartOfTest(i + 1)) break;
      nameParts.push(lines[i]);
      i++;
    }
    if (i >= lines.length || lines[i].startsWith('Исполнитель')) break;

    const testName = strip(nameParts.join(' '));
    const resultText = lines[i]; i++;
    const refText = i < lines.length ? lines[i] : null; i++;

    let deviation;
    if (i < lines.length && lines[i] === '-') { deviation = '-'; i++; } else {
      const parts = [];
      while (i < lines.length) {
        if (lines[i].startsWith('Исполнитель')) break;
        if (lines[i] === '-' || lines[i].startsWith('Ненормальный') || UNIT.test(lines[i]) || isStartOfTest(i)) break;
        parts.push(lines[i]); i++;
        if (parts.length > 6) break;
      }
      deviation = parts.length ? strip(parts.join(' ')) : '-';
    }

    let criticality;
    if (i < lines.length && lines[i] === '-') { criticality = '-'; i++; } else if (i < lines.length && lines[i].startsWith('Ненормальный')) {
      const parts = [];
      while (i < lines.length) {
        if (lines[i].startsWith('Исполнитель')) break;
        if (UNIT.test(lines[i]) || isStartOfTest(i)) break;
        parts.push(lines[i]); i++;
        if (parts.length > 12) break;
      }
      criticality = parts.length ? strip(parts.join(' ')) : '-';
    } else criticality = '-';

    let units = i < lines.length ? lines[i] : null;
    if (units && !UNIT.test(units) && isStartOfTest(i)) units = null;
    i++;

    const [refLow, refHigh] = parseRefRange(refText);
    out.push(obs({ test_name: testName, result_text: resultText, result_num: toFloat(resultText), ref_text: refText, ref_low: refLow, ref_high: refHigh, deviation_text: deviation, criticality_text: criticality, units }));
  }
  return out;
}

/** Urinalysis printouts glue qualitative fields to their neighbours; split them back (as the Python parser does). */
function cleanup(raw, list) {
  if (!raw.includes('Клинический анализ мочи')) return list;
  const out = [];
  for (let o of list) {
    let name = strip(o.test_name || '');
    if (!name && strip(o.ref_text || '') === '0 - 34' && (o.units || '').toLowerCase() === 'мкмоль/л') {
      name = 'Уробилин качественно';
      o = obs({ ...o, test_name: name });
    }
    const low = name.toLowerCase();
    if (low.startsWith('прозрачность') && low.includes('удельный вес')) {
      const m = /прозрачность\s+(.*?)\s+удельный\s+вес/iu.exec(name);
      const v = m ? strip(m[1]) : null;
      if (v) out.push(qualitative('Прозрачность', v));
      out.push(obs({ ...o, test_name: 'Удельный вес' }));
      continue;
    }
    if (low.startsWith('цвет') && low.includes('кровь')) {
      const m = /цвет\s+(.*?)\s+кровь/iu.exec(name);
      const v = m ? strip(m[1]) : null;
      if (v) out.push(qualitative('Цвет', v));
      out.push(obs({ ...o, test_name: 'Кровь полуколичественно' }));
      continue;
    }
    const empty = o.result_text == null || strip(String(o.result_text)) === '';
    if (low.startsWith('прозрачность') && empty) {
      const m = new RegExp(`прозрачность\\s+(.*?)${STATUS_TAIL}`, 'iu').exec(name);
      const v = m ? strip(m[1]) : null;
      if (v) o = qualitative('Прозрачность', v);
    } else if (low.startsWith('цвет') && empty) {
      const m = new RegExp(`цвет\\s+(.*?)${STATUS_TAIL}`, 'iu').exec(name);
      const v = m ? strip(m[1]) : null;
      if (v) o = qualitative('Цвет', v);
    }
    if ((o.test_name === 'Прозрачность' || o.test_name === 'Цвет') && o.result_text) {
      const m = new RegExp(`^(.*?)${STATUS_TAIL}`, 'iu').exec(o.result_text);
      o = qualitative(o.test_name, m ? strip(m[1]) : strip(o.result_text));
    }
    out.push(o);
  }
  return out;
}

export const META = {
  id: 'mknc_pdf_v1',
  name: 'МКНЦ им. А. С. Логинова',
  country: 'RU',
  description: 'Бланки лабораторной информационной системы МКНЦ: кровь, биохимия, моча. Таблица «Тест / Результат / Норма / Отклонение / Ед. изм.»',
  // Tried for any PDF no other parser claims: its table layout is generic enough to catch similar LIS printouts.
  fallback: true,
};

export function detect(text) {
  const ls = splitlines(text).map(strip);
  return ls.includes('Тест') && ls.some((ln) => ln.startsWith('Исполнитель'));
}

/** Throws on an impossible «Дата:» like the Python parser (the registry then treats the parser as not matching). */
export function parseText(text) {
  const t = String(text);
  const lines = splitlines(t).map(strip).filter(Boolean);
  const dm = /Дата:\s*(\d{2}\.\d{2}\.\d{4})/.exec(t);
  const docDate = dm ? ruDateIso(dm[1]) : null;
  const lm = /ГБУЗ\s+«([^»]+)»/.exec(t);
  const labName = lm ? strip(lm[1].replace(/\n/g, ' ')) : null;
  return { lab_name: labName, doc_date: docDate, observations: cleanup(t, parseTable(lines)) };
}
