/**
 * Claude API helpers. Reads ANTHROPIC_API_KEY from the environment; when it is missing
 * every helper throws { code: 'no_api_key' } so routes can answer 503 without crashing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { egressDispatcher } from './egress.js';
import { patientPrompt, prompt } from './aiPrompts.js';
import { secret } from './config.js';
import { normalizeLanguage } from '../../../shared/format.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';

let client = null; let clientKey = '';
export function claudeClient() {
  const apiKey = secret('anthropicApiKey');
  if (!apiKey) {
    const e = new Error('ANTHROPIC_API_KEY is not set');
    e.code = 'no_api_key';
    throw e;
  }
  if (!client || clientKey !== apiKey) {
    const dispatcher = egressDispatcher();
    // one bounded attempt: the SDK default is 10 minutes × 3 tries
    client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 1, ...(dispatcher ? { fetchOptions: { dispatcher } } : {}) });
    clientKey = apiKey;
  }
  return client;
}

const imagingReports = new Map();
/** The structure of a parsed radiology report; the field hints are in the prompt's language. */
export function imagingReport(language) {
  const lang = normalizeLanguage(language);
  if (!imagingReports.has(lang)) {
    const hint = (key) => prompt(lang, `imagingSchema.${key}`);
    imagingReports.set(lang, z.object({
      modality: z.string().describe(hint('modality')),
      region: z.string().describe(hint('regionZod')),
      date: z.string().nullable().describe(hint('date')),
      impression: z.string().describe(hint('impressionZod')),
      response: z.enum(['CR', 'PR', 'SD', 'PD', 'NA']).describe(hint('responseZod')),
      lesions: z.array(z.object({
        name: z.string().describe(hint('lesionName')),
        location: z.string().nullable().describe(hint('lesionLocation')),
        sizeMm: z.number().nullable().describe(hint('sizeMmZod')),
        prevSizeMm: z.number().nullable().describe(hint('prevSizeMmZod')),
        note: z.string().nullable(),
      })),
      newLesions: z.boolean().describe(hint('newLesions')),
      warnings: z.array(z.string()).describe(hint('warnings')),
    }));
  }
  return imagingReports.get(lang);
}

export const imagingSystem = (language) => patientPrompt(language, 'imagingParse');

/** Generic structured extraction on the Claude API: { files, text, system, zodSchema, instruction }. */
export async function parseStructuredWithClaude({ files = [], text = '', system, zodSchema, instruction, model, language }) {
  const c = claudeClient();
  const content = [];
  for (const f of files) {
    if (f.mimeType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data.toString('base64') } });
    } else if (['image/jpeg', 'image/png', 'image/webp'].includes(f.mimeType)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.mimeType, data: f.data.toString('base64') } });
    }
  }
  if (text.trim()) content.push({ type: 'text', text: text.trim() });
  if (!content.length) { const e = new Error('nothing to parse'); e.code = 'empty'; throw e; }
  content.push({ type: 'text', text: instruction || prompt(language, 'structuredInstructionClaude') });
  const response = await c.messages.parse({
    model: model || process.env.LLM_MODEL_OVERRIDE || MODEL, max_tokens: 16000, system, messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(zodSchema), effort: 'medium' },
  });
  if (response.stop_reason === 'refusal') { const e = new Error('model refused'); e.code = 'refusal'; throw e; }
  if (!response.parsed_output) { const e = new Error('could not parse structured output'); e.code = 'bad_output'; throw e; }
  return { data: response.parsed_output, usage: response.usage, model: response.model };
}
