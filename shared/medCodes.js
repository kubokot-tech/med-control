/**
 * Stored values that are words: imaging modality and infusion route. They stay Russian in the database, the code groups
 * and compares by them (gateway lib/recist.js, lib/infusions.js), so they work as codes: the label on a screen comes from
 * the dictionary, imaging.modality.<code> and infusions.route.<code>. A value not listed here was typed by a person or
 * came from a report and is shown as it is. Shared by the gateway and the frontend, types in medCodes.d.ts.
 */
export const MODALITY_CT = 'КТ';
export const MODALITY_PET_CT = 'ПЭТ-КТ';

// code of the dictionary key by stored value; the first five are what the forms offer
const MODALITY_CODES = { [MODALITY_CT]: 'ct', 'МРТ': 'mri', [MODALITY_PET_CT]: 'petCt', 'УЗИ': 'us', 'Рентген': 'xray', 'Сцинтиграфия': 'nm' };
export const MODALITIES = Object.keys(MODALITY_CODES).slice(0, 5);
/** 'КТ' → 'ct'; null for anything else. */
export const modalityCode = (value) => (Object.hasOwn(MODALITY_CODES, value ?? '') ? MODALITY_CODES[value] : null);

export const ROUTE_IV_DRIP = 'в/в капельно';
export const ROUTE_OTHER = 'другое';
export const DEFAULT_DOSE_UNIT = 'мг';
const ROUTE_CODES = { [ROUTE_IV_DRIP]: 'ivDrip', 'в/в струйно': 'ivPush', 'в/м': 'im', 'п/к': 'sc', [ROUTE_OTHER]: 'other' };
export const ROUTES = Object.keys(ROUTE_CODES);
/** 'в/в капельно' → 'ivDrip'; null for anything else. */
export const routeCode = (value) => (Object.hasOwn(ROUTE_CODES, value ?? '') ? ROUTE_CODES[value] : null);

/** A route given by a shot and not a drip; true for a value typed by hand that says so. */
export const isShotRoute = (route) => /в\/м|п\/к|струйн|укол|инъекц/i.test(route || '');
