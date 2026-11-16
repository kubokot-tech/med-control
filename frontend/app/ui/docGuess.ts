/** Guess date, modality and a title from a file name like "КТ ОГК 03.02.2026.pdf" or "2026-02-03_helix.pdf". */
const MONTHS: Record<string, number> = { янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };

export function guessDate(name: string): string | null {
  const s = name.toLowerCase();
  let m = s.match(/(20\d{2})[-._ ]?(0[1-9]|1[0-2])[-._ ]?(0[1-9]|[12]\d|3[01])/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(0[1-9]|[12]\d|3[01])[-._ ](0[1-9]|1[0-2])[-._ ](20\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/(0?[1-9]|[12]\d|3[01])\s*(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.?\s*(20\d{2})/);
  if (m) return `${m[3]}-${String(MONTHS[m[2].slice(0, 3)] || MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function guessModality(name: string): string | null {
  const s = name.toLowerCase();
  if (/пэт|pet/.test(s)) return 'ПЭТ-КТ';
  if (/мрт|mri|mrt/.test(s)) return 'МРТ';
  if (/\bкт\b|_кт|кт_|кт\s|\bct\b|_ct|ct_/.test(s)) return 'КТ';
  if (/узи|ultra/.test(s)) return 'УЗИ';
  if (/рентген|x-?ray|рг/.test(s)) return 'Рентген';
  return null;
}

export function looksLikeImaging(name: string): boolean {
  return guessModality(name) !== null;
}

export function titleFrom(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Документ';
}
