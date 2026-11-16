/** Port of ingestion/app/connectors/helix_pdf_v1.py (Helix personal-account reports): keep the two in step. */
import { strip, split, splitlines, pyFloat, ruDateIso } from './py.js';

const NUM = /^[-+]?\d+[.,]?\d*$/;
const UNIT = /(ммоль\/л|мкмоль\/л|г\/л|мг\/л|мкг\/л|нг\/мл|пг\/мл|ед\/л|Ед\/л|сек|%|\*10\^\d+\/л|\*10\^\d+\/л|fL|пг|мм\/ч|мл\/мин\/1,73м\^2)/i;
const PERSON = /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s|,|$)/;
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

const lines = (text) => splitlines(String(text).replace(/ /g, ' ')).map(strip).filter(Boolean);

function isNoise(line) {
  const low = strip(line.toLowerCase());
  if (PERSON.test(strip(line))) return true;
  const starts = ['пациент', 'дата рождения', 'пол:', 'перейти в личный кабинет', 'заказ', 'зарегистрирован', 'заказчик', 'место взятия', 'образец', 'вид материала',
    'регистрация', 'валидация', 'подтверждение', '* время указано', '** референс', 'персональные данные', 'результаты анализов', 'интерпретацию', 'отчет создан', 'страница'];
  if (starts.some((p) => low.startsWith(p))) return true;
  return low.includes('заказ №') || low.includes('в совокупности с данными анамнеза');
}

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

export const META = {
  id: 'helix_pdf_v1',
  name: 'Хеликс',
  country: 'RU',
  description: 'Бланки из личного кабинета «Хеликс»: много небольших таблиц «Название/показатель — Результат — Ед. — Референс» подряд',
  fallback: false,
};

export const detect = (text) => text.includes('Перейти в Личный кабинет') || text.includes('Заказ №') || text.includes('Зарегистрирован:');

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
  const isMethod = (low) => low.startsWith('метод') || low.startsWith('метод и оборудование');

  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i];
    if (isNoise(ln)) continue;
    const low = strip(ln.toLowerCase());
    const hasDigit = /\d/.test(ln);

    if (!inTable && !isMethod(low) && !low.startsWith('название/показатель')) {
      if (!hasDigit && pyLen(ln) > 2 && !low.startsWith('комментарий')) section = ln;
    }
    if (inTable && !isMethod(low) && !low.startsWith('название/показатель') && !low.startsWith('комментарий')) {
      if (!hasDigit && pyLen(ln) > 2 && !GENERIC_LABELS.has(low)) { section = ln; continue; }
    }
    if (low.startsWith('название/показатель')) { inTable = true; pendingName = null; continue; }
    if (!inTable) continue;
    if (ln.startsWith('*') || low.startsWith('отчет создан')) { inTable = false; pendingName = null; continue; }
    if (isMethod(low)) continue;
    if (['cobas', 'roche diagnostics', 'beckman', 'mindray'].some((w) => low.includes(w))) continue;
    if (low.startsWith('комментарий')) continue;

    const parts = split(ln);
    if (!parts.length) continue;
    const vidx = parts.findIndex((tok) => tok.startsWith('<') || tok.startsWith('>') || NUM.test(tok));
    if (vidx === -1) { pendingName = ln; continue; }

    let unit = null;
    const next = parts[vidx + 1];
    if (next !== undefined && UNIT.test(next)) unit = next;
    else if (next !== undefined && (next.includes('/') || next.includes('^') || next.includes('%'))) unit = next;
    else continue;

    let name = strip(vidx > 0 ? parts.slice(0, vidx).join(' ') : (pendingName || ''));
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

    const valTok = parts[vidx];
    const cmp = valTok.startsWith('<') || valTok.startsWith('>');
    const tail = parts.slice(vidx + 2).join(' ');
    let refText = refFromText(tail);
    if (!refText && i + 1 < ls.length) refText = refFromText(ls[i + 1]);
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
