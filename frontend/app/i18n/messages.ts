// Interface dictionaries (docs/I18N.md): one JSON file per section in locales/<language>/, shared with the gateway.
// A new section is a new file here; another language is another folder with the same files.
import errors from '../../../locales/ru/errors.json';
import common from '../../../locales/ru/common.json';
import ai from '../../../locales/ru/ai.json';
import alerts from '../../../locales/ru/alerts.json';
import auth from '../../../locales/ru/auth.json';
import biomarkers from '../../../locales/ru/biomarkers.json';
import consults from '../../../locales/ru/consults.json';
import contacts from '../../../locales/ru/contacts.json';
import feed from '../../../locales/ru/feed.json';
import history from '../../../locales/ru/history.json';
import home from '../../../locales/ru/home.json';
import imaging from '../../../locales/ru/imaging.json';
import infusions from '../../../locales/ru/infusions.json';
import ipad from '../../../locales/ru/ipad.json';
import labs from '../../../locales/ru/labs.json';
import meds from '../../../locales/ru/meds.json';
import notes from '../../../locales/ru/notes.json';
import protocol from '../../../locales/ru/protocol.json';
import report from '../../../locales/ru/report.json';
import search from '../../../locales/ru/search.json';
import settings from '../../../locales/ru/settings.json';
import symptoms from '../../../locales/ru/symptoms.json';
import ui from '../../../locales/ru/ui.json';
import welcome from '../../../locales/ru/welcome.json';

import enErrors from '../../../locales/en/errors.json';
import enCommon from '../../../locales/en/common.json';
import enAi from '../../../locales/en/ai.json';
import enAlerts from '../../../locales/en/alerts.json';
import enAuth from '../../../locales/en/auth.json';
import enBiomarkers from '../../../locales/en/biomarkers.json';
import enConsults from '../../../locales/en/consults.json';
import enContacts from '../../../locales/en/contacts.json';
import enFeed from '../../../locales/en/feed.json';
import enHistory from '../../../locales/en/history.json';
import enHome from '../../../locales/en/home.json';
import enImaging from '../../../locales/en/imaging.json';
import enInfusions from '../../../locales/en/infusions.json';
import enIpad from '../../../locales/en/ipad.json';
import enLabs from '../../../locales/en/labs.json';
import enMeds from '../../../locales/en/meds.json';
import enNotes from '../../../locales/en/notes.json';
import enProtocol from '../../../locales/en/protocol.json';
import enReport from '../../../locales/en/report.json';
import enSearch from '../../../locales/en/search.json';
import enSettings from '../../../locales/en/settings.json';
import enSymptoms from '../../../locales/en/symptoms.json';
import enUi from '../../../locales/en/ui.json';
import enWelcome from '../../../locales/en/welcome.json';

export const ru = { errors, common, ai, alerts, auth, biomarkers, consults, contacts, feed, history, home, imaging, infusions, ipad, labs, meds, notes, protocol, report, search, settings, symptoms, ui, welcome };
export const en: typeof ru = { errors: enErrors, common: enCommon, ai: enAi, alerts: enAlerts, auth: enAuth, biomarkers: enBiomarkers, consults: enConsults, contacts: enContacts, feed: enFeed, history: enHistory, home: enHome, imaging: enImaging, infusions: enInfusions, ipad: enIpad, labs: enLabs, meds: enMeds, notes: enNotes, protocol: enProtocol, report: enReport, search: enSearch, settings: enSettings, symptoms: enSymptoms, ui: enUi, welcome: enWelcome };

export type Messages = typeof ru;
export type Language = 'ru' | 'en';
export const LANGUAGES: Record<Language, Messages> = { ru, en };
export const DEFAULT_LANGUAGE: Language = 'ru';
/** Each language by its own name, whatever the interface language is. */
export const LANGUAGE_NAMES: Record<Language, string> = { ru: 'Русский', en: 'English' };
export const isLanguage = (l: unknown): l is Language => typeof l === 'string' && l in LANGUAGES;
// For plain modules outside React (ui/api.ts); I18nProvider keeps it current.
let active: Language = DEFAULT_LANGUAGE;
export const activeLanguage = (): Language => active;
export const setActiveLanguage = (l: Language) => { active = l; };

/** The cookie that tells the server which language to render, so the first paint is already right. */
export const LANGUAGE_COOKIE = 'mc_lang';

/** The saved choice, else the first language of the browser we have, else English; no header at all: the default. */
export function pickLanguage(saved?: string | null, acceptLanguage?: string | null): Language {
  if (isLanguage(saved)) return saved;
  if (!acceptLanguage) return DEFAULT_LANGUAGE;
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0].trim().slice(0, 2).toLowerCase();
    if (isLanguage(tag)) return tag;
  }
  return 'en';
}
