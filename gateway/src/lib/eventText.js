/**
 * Texts the gateway generated and stored: feed titles, milestone titles, journal notes. They were written in the
 * language of that day, so on the way to a screen they follow the reader (docs/I18N.md, «Что хранится по-русски»):
 * a text that is one of our own templates in another language is written again in the reader's language; what a person
 * typed (a title, a drug name, a place) stays as it is inside it. A text already in the reader's language is not touched.
 */
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../shared/format.js';
import { displayUnit } from '../../../shared/units.js';
import { modalityCode, routeCode, MODALITIES } from '../../../shared/medCodes.js';
import { aiFormat } from './aiFormat.js';
import { has, relocalize, t } from './i18n.js';

const RESPONSES = ['CR', 'PR', 'SD', 'PD'];
const MODALITY_CODES = [...MODALITIES.map(modalityCode), 'nm'];
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** A milestone kind in words. */
export const kindLabel = (kind, language) => (has(language, `history.kindLabels.${kind}`) ? t(language, `history.kindLabels.${kind}`) : kind);

/** A stored route in words; a value we do not know stays as it is. */
export const routeLabel = (route, language) => { const c = routeCode(route); return c ? t(language, `infusions.route.${c}`) : route; };

/** A stored modality in words; a value we do not know stays as it is. */
export const modalityLabel = (modality, language) => { const c = modalityCode(modality); return c ? t(language, `imaging.modality.${c}`) : modality; };

/** The title of a study's milestone: «КТ органы грудной клетки: частичный ответ». */
export function studyTitle(s, language) {
  const response = s.response && s.response !== 'NA' ? `: ${t(language, `imaging.responseLabel.${s.response}`)}` : '';
  return `${modalityLabel(s.modality, language)}${s.region ? ` ${s.region}` : ''}${response}`;
}

const studyRxs = new Map();
function studyRx(language) {
  if (!studyRxs.has(language)) {
    const words = (keys, prefix) => keys.map((k) => escapeRx(t(language, `${prefix}.${k}`))).join('|');
    studyRxs.set(language, new RegExp(`^(?<modality>${words(MODALITY_CODES, 'imaging.modality')})(?: (?<region>.*?))?(?:: (?<response>${words(RESPONSES, 'imaging.responseLabel')}))?$`, 's'));
  }
  return studyRxs.get(language);
}
/** A study title stored in another language; a title that does not have the form of ours was typed and stays. */
function studyTitleFor(title, language) {
  for (const other of LANGUAGES) {
    if (other === language) continue;
    const m = studyRx(other).exec(title);
    if (!m) continue;
    const code = MODALITY_CODES.find((c) => t(other, `imaging.modality.${c}`) === m.groups.modality);
    const response = RESPONSES.find((c) => t(other, `imaging.responseLabel.${c}`) === m.groups.response);
    return `${t(language, `imaging.modality.${code}`)}${m.groups.region ? ` ${m.groups.region}` : ''}${response ? `: ${t(language, `imaging.responseLabel.${response}`)}` : ''}`;
  }
  return title;
}

const appointmentTitleFor = (title, language) => relocalize(title, ['feedTitles.appointment'], language, ({ doctor }) => ({
  doctor: LANGUAGES.some((l) => t(l, 'feedTitles.appointmentDoctor') === doctor) ? t(language, 'feedTitles.appointmentDoctor') : doctor,
}));

/** «март 2026» written in another language, in this one; any other text as it is. */
function monthFor(text, language) {
  const m = /^(\S+) (\d{4})$/.exec(text);
  if (!m) return text;
  for (const other of LANGUAGES) {
    const i = aiFormat(other).months('long').indexOf(m[1]);
    if (i >= 0) return `${aiFormat(language).months('long')[i]} ${m[2]}`;
  }
  return text;
}

/** A milestone title for the reader: the generated ones (a study, an appointment, a monthly review) follow the language. */
export function milestoneTitle(kind, title, language) {
  if (kind === 'imaging') return studyTitleFor(title, language);
  if (kind === 'consult') return appointmentTitleFor(title, language);
  if (kind === 'ai_review') return relocalize(title, ['aiContext.monthly.title'], language, ({ month }) => ({ month: monthFor(month, language) }));
  return title;
}

/** A dose unit as stored ('mg', 'мкг'), as the language writes it. */
export const doseUnit = (unit, language) => (language === DEFAULT_LANGUAGE ? String(unit || '').replace(/^mg$/i, 'мг') : displayUnit(String(unit || ''), language));

/** «… 20 мг» at the end of a generated text: the unit as the language writes it. */
export const unitAtEnd = (s, language) => s.replace(/(\d)\s+(\S+)$/, (_, d, u) => `${d} ${displayUnit(u, language)}`);

/** A note the gateway itself put on a dose or a dose change. Any other note was typed. */
export const doseNote = (notes, language) => relocalize(notes, ['feedTitles.noteCalendar', 'feedTitles.noteLegacyFill', 'feedTitles.notePrescribed', 'feedTitles.noteButton'], language);

function infusionNotes(notes, language) {
  return notes.split(' · ').map((part) => {
    const c = routeCode(part);
    return c ? t(language, `infusions.route.${c}`) : relocalize(part, ['feedTitles.reaction'], language);
  }).join(' · ');
}

/** { title, notes } of a feed event for the reader. `kind` is the milestone kind of a MILESTONE event. */
export function feedText({ type, title, notes, source, kind }, language) {
  if (title == null) return { title, notes: type === 'MED_ADMIN' ? doseNote(notes, language) : notes };
  if (type === 'MILESTONE') {
    for (const other of LANGUAGES) {
      const prefix = `${kindLabel(kind, other)}: `;
      if (other !== language && title.startsWith(prefix)) return { title: `${kindLabel(kind, language)}: ${milestoneTitle(kind, title.slice(prefix.length), language)}`, notes };
    }
    return { title, notes };
  }
  if (type === 'MED_ADMIN') return { title: relocalize(title, ['feedTitles.medDose'], language), notes: doseNote(notes, language) };
  if (type === 'INFUSION') {
    return {
      title: relocalize(title, ['feedTitles.shot', 'feedTitles.drip', 'feedTitles.other'], language, ({ what }) => ({ what: unitAtEnd(what, language) })),
      notes: notes == null ? notes : infusionNotes(notes, language),
    };
  }
  if (type === 'NOTE' && source === 'notes') return { title: relocalize(title, ['feedTitles.note'], language), notes };
  if (type === 'NOTE' && source === 'meds') {
    const text = relocalize(title, ['feedTitles.medStart', 'feedTitles.medStop', 'feedTitles.doseChange'], language, (a) => ({
      ...a, ...(a.name != null ? { name: unitAtEnd(a.name, language) } : {}), ...(a.unit != null ? { unit: displayUnit(a.unit, language) } : {}),
    }));
    return { title: text, notes };
  }
  return { title, notes };
}
