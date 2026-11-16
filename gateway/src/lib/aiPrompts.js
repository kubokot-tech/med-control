/**
 * System prompts by language (docs/I18N.md, rule 6): locales/<language>/server/aiPrompts.json. A prompt is the same text
 * for everyone with that language, so the provider's prompt cache keeps working. The base instruction goes first in every
 * prompt about the patient's data.
 */
import { raw } from './i18n.js';

/** A prompt as written. */
export const prompt = (language, key) => raw(language, `aiPrompts.${key}`);
/** The base instruction and the task. Diagnosis and history come from the profile, not from this text. */
export const patientPrompt = (language, key) => `${prompt(language, 'base')}\n${prompt(language, key)}`;
