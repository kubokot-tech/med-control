import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, imagingJsonSchema, llmConfig } from '../src/lib/llm.js';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { imagingReport } from '../src/lib/claude.js';
import { labsParseSchema } from '../src/lib/labsAiParse.js';

const ImagingReport = imagingReport('ru');
const LabsParse = labsParseSchema('ru');
const IMAGING_JSON_SCHEMA = imagingJsonSchema('ru');

test('extractJson: plain, fenced, embedded', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Вот:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('текст {"a":3} хвост'), { a: 3 });
  assert.equal(extractJson('ничего'), null);
});

test('json schema and zod agree on a full report', () => {
  const sample = { modality: 'КТ', region: 'ОГК', date: '2026-03-01', impression: 'Стабильно', response: 'SD', newLesions: false, warnings: [],
    lesions: [{ name: 'S6 справа', location: null, sizeMm: 8.5, prevSizeMm: 9, note: null }] };
  assert.equal(ImagingReport.safeParse(sample).success, true);
  for (const k of IMAGING_JSON_SCHEMA.required) assert.ok(k in sample, k);
  for (const k of IMAGING_JSON_SCHEMA.properties.lesions.items.required) assert.ok(k in sample.lesions[0], k);
});

test('llmConfig picks provider by key', () => {
  const env = { ...process.env };
  delete process.env.LLM_PROVIDER; delete process.env.LLM_MODEL; delete process.env.OPENROUTER_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  assert.equal(llmConfig().provider, 'none');
  process.env.ANTHROPIC_API_KEY = 'x';
  assert.equal(llmConfig().provider, 'anthropic');
  process.env.OPENROUTER_API_KEY = 'y';
  assert.equal(llmConfig().provider, 'openrouter');
  assert.equal(llmConfig().model, 'anthropic/claude-opus-5');
  process.env.LLM_PROVIDER = 'anthropic';
  assert.equal(llmConfig().provider, 'anthropic');
  process.env = env;
});

test('Claude structured output: SDK builds the format from our zod schemas and parses with them', () => {
  // The SDK helper needs zod 4 schemas; with zod 3 it threw before any request was sent.
  for (const schema of [ImagingReport, LabsParse]) {
    const f = zodOutputFormat(schema);
    assert.equal(f.type, 'json_schema');
    assert.equal(f.schema.type, 'object');
  }
  const report = { modality: 'КТ', region: 'ОГК', date: null, impression: 'Стабильно', response: 'SD', newLesions: false, warnings: [], lesions: [] };
  assert.deepEqual(zodOutputFormat(ImagingReport).parse(JSON.stringify(report)), report);
  assert.throws(() => zodOutputFormat(ImagingReport).parse(JSON.stringify({ ...report, response: 'XX' })));
});
