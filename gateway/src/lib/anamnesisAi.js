/** Draft of an updated master context (anamnesis) from the current text and MedControl data. The user accepts it in the UI. */
import { llmChat } from './llm.js';
import { getSetting } from './settings.js';
import { buildFullDossier } from './patientProfile.js';
import { prompt } from './aiPrompts.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

export async function draftAnamnesis(userId, { tz } = {}) {
  const current = (getSetting('anamnesis') || '').trim();
  const language = await userLanguage(userId);
  const dossier = await buildFullDossier(userId, { tz, language });
  const user = t(language, 'aiContext.anamnesisUser', { current: current || t(language, 'aiContext.anamnesisEmpty'), dossier });
  const out = await llmChat({ system: prompt(language, 'anamnesisDraft'), user, maxTokens: 14000, timeoutMs: 420_000, language });
  const text = out.text.trim();
  if (!text) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  return { draft: text, model: out.model, usage: out.usage, truncated: Boolean(out.truncated), currentLength: current.length };
}
