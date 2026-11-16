/**
 * Dates and numbers in texts for the AI model (patient profile, dossier, questions, monthly review): the format of the
 * prompt's language, not the user's regional settings (docs/I18N.md). The model reads either; a text that depends only
 * on the language keeps the provider's prompt cache warm.
 */
import { DEFAULT_LANGUAGE, createFormat, normalizeLanguage } from '../../../shared/format.js';

// the region only picks the decimal separator here; the words of a date follow the language
const REGIONS = { ru: 'RU', en: 'US' };
const formats = new Map();
export function aiFormat(language = DEFAULT_LANGUAGE) {
  const lang = normalizeLanguage(language);
  if (!formats.has(lang)) formats.set(lang, createFormat({ language: lang, prefs: { region: REGIONS[lang] } }));
  return formats.get(lang);
}

/** «5,25» with at most `digits` decimals; '' for null. */
export const aiNumber = (n, digits = 2, language) => (n == null ? '' : aiFormat(language).number(n, { maximumFractionDigits: digits }));
/** «5 марта 2026» for a calendar day 'YYYY-MM-DD'. */
export const aiDate = (iso, language) => aiFormat(language).date(iso, { day: 'numeric', month: 'long', year: 'numeric' });
