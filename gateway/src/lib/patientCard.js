/**
 * Who the patient is, for the doctor report header: full name, date of birth, diagnosis in one line (Settings →
 * «Анамнез»), plus how the app addresses them on the home screen: the name to use («Анна», «мама») and whether the
 * diary is kept by the patient or by someone close («Добрый вечер, Анна» or «Как мама сегодня?»), and a small photo
 * (a JPEG data URL of 160×160 px made in the browser, so it lives with the settings and goes to the export archive).
 * Patient data like the anamnesis: goes to the export archive and back. The names and the exact date of birth never
 * go to AI; the AI profile gets only the age and the diagnosis (lib/patientProfile.js).
 */
import { z } from 'zod';
import { getSetting, setSetting } from './settings.js';
import { invalid } from './errors.js';
import { t } from './i18n.js';

export const PATIENT_KEYS = ['patient_name', 'patient_birth', 'patient_diagnosis', 'patient_call_name', 'patient_kept_by', 'patient_photo', 'patient_moments'];
export const KEPT_BY = ['self', 'relative'];
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_MAX = 60_000; // characters; 160×160 px at quality .85 is about 15 000
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function patientCard() {
  const keptBy = getSetting('patient_kept_by');
  return {
    name: getSetting('patient_name') || '', birthDate: getSetting('patient_birth') || '', diagnosis: getSetting('patient_diagnosis') || '',
    callName: getSetting('patient_call_name') || '', keptBy: KEPT_BY.includes(keptBy) ? keptBy : 'self',
    photo: getSetting('patient_photo') || '', moments: getSetting('patient_moments') !== 'off',
  };
}

const Body = z.object({
  name: z.string().trim().max(120).optional(),
  birthDate: z.string().trim().refine((v) => v === '' || DAY.test(v), 'bad date').optional(),
  diagnosis: z.string().trim().max(200).optional(),
  callName: z.string().trim().max(40).optional(),
  keptBy: z.enum(KEPT_BY).optional(),
  photo: z.string().max(PHOTO_MAX).refine((v) => v === '' || PHOTO.test(v), 'bad photo').optional(),
  moments: z.boolean().optional(),
}).strict();

/** Save what was sent; an empty string clears a field. Throws invalid('bad_birth_date') for a date in the future or before 1900. */
export async function savePatientCard(input, { today }) {
  const b = Body.parse(input || {});
  if (b.birthDate && (b.birthDate > today || b.birthDate < '1900-01-01')) throw invalid('bad_birth_date');
  if (b.name !== undefined) await setSetting('patient_name', b.name.replace(/\s+/g, ' '));
  if (b.birthDate !== undefined) await setSetting('patient_birth', b.birthDate);
  if (b.diagnosis !== undefined) await setSetting('patient_diagnosis', b.diagnosis.replace(/\s+/g, ' '));
  if (b.callName !== undefined) await setSetting('patient_call_name', b.callName.replace(/\s+/g, ' '));
  if (b.keptBy !== undefined) await setSetting('patient_kept_by', b.keptBy);
  if (b.photo !== undefined) await setSetting('patient_photo', b.photo);
  if (b.moments !== undefined) await setSetting('patient_moments', b.moments ? '' : 'off');
  return patientCard();
}

/** Full years on `today` ('YYYY-MM-DD'), or null. */
export function ageOn(birthDate, today) {
  if (!DAY.test(birthDate || '') || !DAY.test(today || '')) return null;
  let age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (today.slice(5) < birthDate.slice(5)) age -= 1;
  return age >= 0 ? age : null;
}

/** «1 год», «3 года», «58 лет»; «58 years». */
export const yearsText = (n, language) => t(language, 'aiContext.years', { n });
