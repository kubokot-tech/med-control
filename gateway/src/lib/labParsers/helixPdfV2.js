/** Port of ingestion/app/connectors/helix_pdf_v2.py (Helix personal-account reports, the new layout): keep the two in step. */
import { strip, split, splitlines, pyFloat, ruDateIso } from './py.js';

// A value token: an optional ▲/▼ deviation marker, an optional <,> comparator, then a number.
const VALUE = /^[▲▼↑↓]?[<>]?[-+]?\d+[.,]?\d*$/;
const UNIT = /(ммоль\/л|мкмоль\/л|мкМЕ\/мл|пмоль\/л|нмоль\/л|мМЕ\/л|МЕ\/л|г\/л|мг\/л|мкг\/л|нг\/мл|пг\/мл|ед\/л|Ед\/л|сек|%|\*10\^\d+\/л|fL|пг|мм\/ч|мл\/мин\/1,73м\^2)/i;
// «от 12.01.26»: the date of the previous result, on the line after the row
const PREV_DATE = /^от\s+\d{2}\.\d{2}\.\d{2,4}\s*$/;
// a line that is only a reference: «<38», «9 - 64», «0.35 - 4.9»
const REF_LINE = /^[<>]?\s*[-+]?\d+[.,]?\d*(?:\s*-\s*[-+]?\d+[.,]?\d*)?\s*$/;
const PERSON = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s|,|$)/;
// The new header prints the name in capitals with «(Муж., …)» / «(Жен., …)» after it.
const PERSON_CAPS = /^[А-ЯЁ][а-яёА-ЯЁ-]*\s+[А-ЯЁ][а-яёА-ЯЁ-]*\s+[А-ЯЁ][а-яёА-ЯЁ-]*\s*\(/;
const GENERIC_LABELS = new Set(['активность', 'концентрация', 'время', 'расчет', 'результат', 'доля', 'доля,%', 'доля, %']);
const NUM_TXT = '([-+]?\\d+[\\.,]?\\d*)';

const toFloat = (s) => { const t = strip(s ?? '').replace(/ /g, '').replace(/,/g, '.'); return t ? pyFloat(t) : null; };
const pyLen = (s) => [...s].length;

function parseRef(ref) {
  if (!ref) return [null, null];
  const r = strip(ref);
  let m = new RegExp(`^\\s*${NUM_TXT}\\s*-\\s*${NUM_TXT}\\s*$`).exec(r);
  if (m) return [toFloat(m[1]), toFloat(m[2])];
  m = new RegExp(`^\\s*<\\s*${NUM_TXT}\\s*$`).exec(r);
  if (m) return [null, toFloat(m[1])];
  m = new RegExp(`^\\s*>\\s*${NUM_TXT}\\s*$`).exec(r);
  if (m) return [toFloat(m[1]), null];
  return [null, null];
}

const lines = (text) => splitlines(String(text).replace(/ /g, ' ')).map(strip).filter(Boolean);

function isNoise(line) {
  const low = strip(line.toLowerCase());
  if (PERSON.test(strip(line)) || PERSON_CAPS.test(strip(line))) return true;
  if (low.includes('(муж.') || low.includes('(жен.')) return true;
  const starts = ['пациент', 'дата рождения', 'пол:', 'перейти в личный кабинет', 'заказ', 'зарегистрирован', 'заказчик', 'место взятия', 'образец', 'вид материала',
    'регистрация', 'валидация', 'подтверждение', 'подлинности', '* время указано', '** референс', 'персональные данные', 'результаты анализов', 'интерпретацию', 'отчет создан', 'страница'];
  if (starts.some((p) => low.startsWith(p))) return true;
  // sample line: «Венозная кровь, № 1112223334, валидация 05.03.2026 18:20:00 *»
  if (line.includes('№') && low.includes('валидация')) return true;
  return low.includes('заказ №') || low.includes('в совокупности с данными анамнеза');
}

const looksUnit = (tok) => UNIT.test(tok) || tok.includes('/') || tok.includes('^') || tok.includes('%');

function refFromText(t) {
  if (!t) return null;
  let m = new RegExp(`${NUM_TXT}\\s*-\\s*${NUM_TXT}`).exec(t);
  if (m) return `${m[1]} - ${m[2]}`;
  m = new RegExp(`<\\s*${NUM_TXT}`).exec(t);
  if (m) return `<${m[1]}`;
  m = new RegExp(`>\\s*${NUM_TXT}`).exec(t);
  if (m) return `>${m[1]}`;
  return null;
}

/** The reference under the row: the next line, or the one after the previous-result date («от 12.01.26»).
 * Only a line that is nothing but a reference counts, so the next row's numbers are never picked up. */
function refOnFollowingLines(ls, i) {
  for (let j = i + 1; j < Math.min(i + 3, ls.length); j++) {
    const nxt = ls[j];
    if (PREV_DATE.test(strip(nxt.toLowerCase()))) continue;
    if (REF_LINE.test(nxt)) return refFromText(nxt);
    break;
  }
  return null;
}

export const META = {
  id: 'helix_pdf_v2',
  name: 'Хеликс (новые бланки)',
  country: 'RU',
  description: 'Новые бланки личного кабинета «Хеликс»: «Название/показатель — Результат — [Предыдущий результат] — Референс», единицы рядом со значением, маркеры ▲/▼',
  fallback: false,
};

/** Helix markers plus the new table header: «Название/показатель Результат …» without the «Ед. изм.» column. */
export const detect = (text) => {
  const t = String(text);
  if (!(t.includes('Перейти в Личный кабинет') || t.includes('Заказ №') || t.includes('Зарегистрирован:'))) return false;
  return splitlines(t).some((ln) => {
    const s = split(ln).join(' ');
    return s.startsWith('Название/показатель') && s.includes('Результат') && !s.includes('Ед. изм.');
  });
};

export function parseText(text) {
  const ls = lines(text);
  const full = ls.join('\n');
  let docDate = null;
  const dm = /Зарегистрирован:\s*(\d{2}\.\d{2}\.\d{4})/.exec(full);
  if (dm) { try { docDate = ruDateIso(dm[1]); } catch { docDate = null; } }

  const observations = [];
  let section = null;
  let inTable = false;
  let pendingName = null;

  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i];
    if (isNoise(ln)) continue;
    const low = strip(ln.toLowerCase());

    // start of a table block (many small tables back-to-back, one per analyte)
    if (low.startsWith('название/показатель')) { inTable = true; pendingName = null; continue; }

    if (!inTable) {
      // section title before the first table; it may contain digits («Тироксин (Т4) свободный»)
      if (low.startsWith('метод') || low.startsWith('комментарий') || PREV_DATE.test(low) || REF_LINE.test(ln)) continue;
      if (pyLen(ln) > 2 && !GENERIC_LABELS.has(low)) section = ln;
      continue;
    }

    // end of table on footer
    if (ln.startsWith('*') || low.startsWith('отчет создан')) { inTable = false; pendingName = null; continue; }

    // skip method/equipment and comment lines inside the table
    if (low.startsWith('метод') || low.startsWith('комментарий')) continue;
    if (['cobas', 'roche diagnostics', 'beckman', 'mindray'].some((w) => low.includes(w))) continue;
    // the previous-result date and the reference under the row are consumed by the row itself
    if (PREV_DATE.test(low) || REF_LINE.test(ln)) continue;

    const parts = split(ln);
    if (!parts.length) continue;
    const vidx = parts.findIndex((tok) => VALUE.test(tok));

    if (vidx === -1) {
      // not a row: a new analyte title (digits allowed, «Тироксин (Т4) свободный») or a wrapped name
      if (pyLen(ln) > 2 && !GENERIC_LABELS.has(low)) section = ln;
      else pendingName = ln;
      continue;
    }

    // the unit sits right after the value; a number without a unit is not a measurement row
    if (vidx + 1 >= parts.length || !looksUnit(parts[vidx + 1])) continue;
    const unit = parts[vidx + 1];

    // a marker printed as its own token belongs to the value, not the name
    let nameEnd = vidx;
    if (vidx > 0 && ['▲', '▼', '↑', '↓'].includes(parts[vidx - 1])) nameEnd = vidx - 1;
    let name = strip(nameEnd > 0 ? parts.slice(0, nameEnd).join(' ') : (pendingName || ''));
    pendingName = null;
    const gen = strip(name.toLowerCase());
    if (GENERIC_LABELS.has(gen)) {
      if (section) name = section;
      else continue;
    }
    if (section) {
      const cs = section.toLowerCase();
      if ((cs.includes('hba1c') || cs.includes('гликирован')) && gen.startsWith('доля')) name = 'Гликированный гемоглобин (HbA1c)';
      if ((cs.includes('ссгп') || cs.includes('среднесуточный уровень глюкозы')) && (gen.includes('плазмы') || gen.includes('ссгп'))) name = 'Среднесуточная глюкоза (eAG)';
    }

    // the ▲/▼ marker is dropped: the deviation is computed from the reference after commit
    const valTok = parts[vidx].replace(/^[▲▼↑↓]+/, '');
    const cmp = valTok.startsWith('<') || valTok.startsWith('>');

    // a second value+unit pair on the same line is the previous result, not the current one
    let after = vidx + 2;
    if (after + 1 < parts.length && VALUE.test(parts[after]) && looksUnit(parts[after + 1])) after += 2;
    const tail = parts.slice(after).join(' ');
    let refText = refFromText(tail);
    if (!refText) refText = refOnFollowingLines(ls, i);
    const [refLow, refHigh] = parseRef(refText);

    observations.push({
      test_name: name,
      result_text: valTok.replace(/,/g, '.'),
      result_num: toFloat(cmp ? valTok.slice(1) : valTok),
      units: unit,
      ref_text: refText,
      ref_low: refLow,
      ref_high: refHigh,
      deviation_text: null,
      criticality_text: null,
    });
  }
  return { lab_name: 'Хеликс', doc_date: docDate, observations };
}
