/**
 * Lab results from any laboratory's PDF via the model, for documents the fixed parsers
 * (see ingestion/app/connectors/registry.py) do not recognise. The result is a draft the user reviews before it is saved.
 */
import { z } from 'zod';
import crypto from 'node:crypto';
import { parseStructured } from './llm.js';
import { prompt } from './aiPrompts.js';
import { normalizeLanguage } from '../../../shared/format.js';

const labsParses = new Map();
/** The structure of a parsed lab report; the field hints are in the prompt's language. */
export function labsParseSchema(language) {
  const lang = normalizeLanguage(language);
  if (!labsParses.has(lang)) {
    const hint = (key) => prompt(lang, `labsSchema.${key}`);
    labsParses.set(lang, z.object({
      lab_name: z.string().nullable().describe(hint('labName')),
      doc_date: z.string().nullable().describe(hint('docDate')),
      observations: z.array(z.object({
        test_name_raw: z.string().describe(hint('testName')),
        result_text: z.string().nullable().describe(hint('resultText')),
        result_num: z.number().nullable().describe(hint('resultNum')),
        unit_raw: z.string().nullable().describe(hint('unit')),
        ref_text_raw: z.string().nullable().describe(hint('refText')),
        ref_low: z.number().nullable().describe(hint('refLow')),
        ref_high: z.number().nullable().describe(hint('refHigh')),
        category: z.enum(['blood', 'urine', 'other']).describe(hint('category')),
      })),
      warnings: z.array(z.string()).describe(hint('warnings')),
    }));
  }
  return labsParses.get(lang);
}

const nullable = (t) => ({ type: [t, 'null'] });
export const LABS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lab_name', 'doc_date', 'observations', 'warnings'],
  properties: {
    lab_name: nullable('string'), doc_date: nullable('string'),
    observations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['test_name_raw', 'result_text', 'result_num', 'unit_raw', 'ref_text_raw', 'ref_low', 'ref_high', 'category'],
        properties: {
          test_name_raw: { type: 'string' }, result_text: nullable('string'), result_num: nullable('number'), unit_raw: nullable('string'),
          ref_text_raw: nullable('string'), ref_low: nullable('number'), ref_high: nullable('number'), category: { type: 'string', enum: ['blood', 'urine', 'other'] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

/** files: [{ mimeType, data, name }] → { sha256, lab_name, doc_date, observations, warnings, model, usage } */
export async function parseLabsWithAi({ buf, filename, mimeType = 'application/pdf', language }) {
  const r = await parseStructured({
    files: [{ mimeType, data: buf, name: filename }], system: prompt(language, 'labsParse'), jsonSchema: LABS_JSON_SCHEMA, zodSchema: labsParseSchema(language), name: 'labs',
    instruction: prompt(language, 'labsParseInstruction'), tier: 'main', language,
  });
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { sha256, ...r.data, model: r.model, usage: r.usage };
}
