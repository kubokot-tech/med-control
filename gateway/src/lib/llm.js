/**
 * LLM provider layer (services in llmProviders.js):
 *  - anthropic: direct Claude API (ANTHROPIC_API_KEY), see claude.js;
 *  - everything else speaks OpenAI chat completions: OpenRouter, ChatGPT, DeepSeek, YandexGPT, GigaChat, your own address.
 * Provider comes from the settings or LLM_PROVIDER, otherwise the first service with a key (llmProviders.AUTO_ORDER).
 * Model comes from the settings or LLM_MODEL, otherwise the service's default.
 */
import { imagingReport, imagingSystem, MODEL as ANTHROPIC_MODEL } from './claude.js';
import { egressFetch, egressProxy } from './egress.js';
import { sberFetch } from './sberTls.js';
import { getSetting } from './settings.js';
import { secret } from './config.js';
import { buildPatientProfile, PROMPT_VERSION, languageOf } from './patientProfile.js';
import { prompt } from './aiPrompts.js';
import { needsPageOcr } from './ocr.js';
import { t as tr } from './i18n.js';
import { createHash, randomUUID } from 'node:crypto';

import { PROVIDERS, PROVIDER_IDS, AUTO_ORDER, fillModel, validBaseUrl } from './llmProviders.js';
import { invalid } from './errors.js';

const OPENROUTER_URL = PROVIDERS.openrouter.baseUrl;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Settings from the UI (app_settings) override .env; .env overrides the service's defaults. */
export function llmConfig() {
  const keys = Object.fromEntries(PROVIDER_IDS.map((id) => [id, Boolean(secret(PROVIDERS[id].secret))]));
  const customUrl = validBaseUrl(getSetting('llm_base_url') || process.env.LLM_BASE_URL || '');
  const folder = (getSetting('llm_yandex_folder') || process.env.YANDEX_FOLDER_ID || '').trim();
  let provider = (getSetting('llm_provider') || process.env.LLM_PROVIDER || '').toLowerCase();
  if (!provider || provider === 'auto') provider = AUTO_ORDER.find((id) => keys[id]) || (customUrl ? 'custom' : 'none');
  const p = PROVIDERS[provider] || null;
  const dflt = (tier) => (provider === 'anthropic' && tier === 'main' ? ANTHROPIC_MODEL : fillModel(p?.models?.[tier], { folder }));
  const modelSource = getSetting('llm_model') ? 'settings' : process.env.LLM_MODEL ? 'env' : 'default';
  const model = getSetting('llm_model') || process.env.LLM_MODEL || dflt('main');
  // Fast tier: follow-up questions and per-record comments. Main tier: monthly review, anamnesis, report parsing.
  const modelFastSource = getSetting('llm_model_fast') ? 'settings' : process.env.LLM_MODEL_FAST ? 'env' : 'default';
  const modelFast = getSetting('llm_model_fast') || process.env.LLM_MODEL_FAST || dflt('fast') || model;
  const enabled = Boolean(p) && (provider === 'custom' ? Boolean(customUrl && model) : keys[provider] && (!p.needsFolder || Boolean(folder)));
  return {
    provider, label: p?.label || '', caps: p?.caps || { pdf: false, images: false, schema: false },
    baseUrl: provider === 'custom' ? customUrl : p?.baseUrl || null, customUrl, folder,
    model, modelSource, modelFast, modelFastSource, enabled, proxy: egressProxy(), keys,
    appUrl: (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, ''),
  };
}

function noKey() {
  const e = new Error('no LLM api key');
  e.code = 'no_api_key';
  return e;
}

const nullable = (t) => ({ type: [t, 'null'] });
/** JSON schema for imagingReport() (mirrors the zod schema; strict structured output needs it explicit), hints in the prompt's language. */
export function imagingJsonSchema(language) {
  const hint = (key) => prompt(language, `imagingSchema.${key}`);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['modality', 'region', 'date', 'impression', 'response', 'lesions', 'newLesions', 'warnings'],
    properties: {
      modality: { type: 'string', description: hint('modality') },
      region: { type: 'string', description: hint('region') },
      date: { ...nullable('string'), description: hint('date') },
      impression: { type: 'string', description: hint('impression') },
      response: { type: 'string', enum: ['CR', 'PR', 'SD', 'PD', 'NA'], description: hint('response') },
      lesions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'location', 'sizeMm', 'prevSizeMm', 'note'],
          properties: {
            name: { type: 'string', description: hint('lesionName') },
            location: nullable('string'),
            sizeMm: { ...nullable('number'), description: hint('sizeMm') },
            prevSizeMm: { ...nullable('number'), description: hint('prevSizeMm') },
            note: nullable('string'),
          },
        },
      },
      newLesions: { type: 'boolean' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

// GigaChat signs in with an authorization key for a 30-minute access token (OAuth client credentials).
let gigaToken = { value: '', until: 0, key: '' };
async function gigachatToken(authKey) {
  if (gigaToken.key === authKey && Date.now() < gigaToken.until - 60_000) return gigaToken.value;
  const r = await sberFetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${authKey}`, RqUID: randomUUID() },
    body: `scope=${encodeURIComponent(process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS')}`,
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => { throw Object.assign(new Error(`gigachat oauth: ${e.cause?.code || e.message}`), { code: 'provider' }); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(`gigachat oauth ${r.status}: ${j.message || ''}`.trim()), { code: 'provider', status: r.status });
  gigaToken = { value: j.access_token, until: Number(j.expires_at) || Date.now() + 25 * 60_000, key: authKey };
  return gigaToken.value;
}

/**
 * Services other than OpenRouter get plain OpenAI messages: no cache hints, and text-only content as a string
 * (several of them do not accept content arrays).
 */
function plainMessages(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const parts = m.content.map(({ cache_control: _c, ...rest }) => rest);
    return { ...m, content: parts.every((x) => x.type === 'text') ? parts.map((x) => x.text).join('\n\n') : parts };
  });
}

/**
 * Files for the chosen service: PDFs go as files where it reads them, otherwise as their text layer, and a scan as
 * the text recognised on this machine (ocr.js); images only where it reads images, or recognised the same way when
 * they are documents (ocrImages: lab blanks, reports; not CT slices). Nothing readable is refused with a clear code.
 */
async function filesForModel(files, caps, { ocrImages = false, language } = {}) {
  const pdfs = []; const imgs = []; const texts = [];
  const recognised = async (f) => (await (await import('./ocr.js')).ocrFile({ ...f, language })).text.trim();
  for (const f of files) {
    if (f.mimeType === 'application/pdf') {
      if (caps.pdf) { pdfs.push(f); continue; }
      const { pdfTextPages } = await import('./pdfText.js');
      const layer = await pdfTextPages(f.data).catch(() => ({ pages: [], text: '' }));
      let t = layer.text.trim();
      // a scan, maybe with a printed stamp or header (the same rule as extracts.js)
      if (needsPageOcr(layer)) t = await recognised({ ...f, layers: layer.pages });
      if (!t) throw invalid('model_no_files');
      texts.push(`${tr(language, 'aiContext.fileText', { file: f.name || 'document.pdf' })}\n${t}`);
    } else if (IMAGE_TYPES.includes(f.mimeType)) {
      if (caps.images) { imgs.push(f); continue; }
      const t = ocrImages ? await recognised(f) : '';
      if (!t) throw invalid('model_no_files');
      texts.push(`${tr(language, 'aiContext.imageText', { file: f.name || 'image' })}\n${t}`);
    }
  }
  return { pdfs, imgs, text: texts.join('\n\n') };
}

/** OpenAI-style chat completions with the configured service (OpenRouter or any compatible one). */
async function chatCompletions({ messages, responseFormat, maxTokens = 16000, timeoutMs = 180_000, model: modelOverride } = {}) {
  const cfg = llmConfig();
  const p = PROVIDERS[cfg.provider];
  if (!cfg.enabled || !p || p.kind === 'anthropic') throw noKey();
  const model = modelOverride || cfg.model;
  const openrouter = p.kind === 'openrouter';
  const headers = { 'content-type': 'application/json' };
  if (openrouter) headers['X-Title'] = 'MedControl';
  if (p.auth === 'gigachat') headers.authorization = `Bearer ${await gigachatToken(secret(p.secret))}`;
  else if (secret(p.secret)) headers.authorization = `Bearer ${secret(p.secret)}`;
  if (p.needsFolder) headers['OpenAI-Project'] = cfg.folder;
  const doFetch = p.auth === 'gigachat' ? sberFetch : p.egress ? egressFetch : fetch;
  const msgs = openrouter ? messages : plainMessages(messages);
  // Newer Claude models think by default and the thinking counts against max_tokens: with a small budget the
  // visible answer came back empty («empty answer»). Thinking is switched off for our short, factual prompts.
  const call = async (maxT) => {
    const body = { model, messages: msgs, [p.maxTokensParam || 'max_tokens']: maxT };
    // provider.data_collection=deny: OpenRouter routes only to providers that do not store or train on prompts (medical data)
    if (openrouter) Object.assign(body, { reasoning: { enabled: false, exclude: true }, provider: { data_collection: 'deny' } });
    if (responseFormat) body.response_format = responseFormat;
    // redirects are not followed: a service must not bounce the request (and the key) somewhere else
    const r = await doFetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
      .catch((e) => { throw Object.assign(new Error(`${p.label}: ${e.cause?.code || e.message}`), { code: e.name === 'TimeoutError' ? 'timeout' : 'network' }); });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      const e = new Error(j.error?.message || j.message || `${cfg.provider} ${r.status}`);
      e.code = 'provider';
      e.status = r.status || j.error?.code;
      throw e;
    }
    const choice = j.choices?.[0];
    const content = choice?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text || '').join('') : '';
    return { text, finish: choice?.finish_reason, usage: j.usage || {}, model: j.model || model, reasoningTokens: j.usage?.completion_tokens_details?.reasoning_tokens || 0 };
  };
  let out = await call(maxTokens);
  // a model that still spent the budget on reasoning gets one retry with a bigger budget
  if (!out.text.trim() && out.finish === 'length' && out.reasoningTokens > 0) out = await call(maxTokens * 3);
  return out;
}

/** Pull the first JSON object out of free text (models sometimes wrap it in ``` fences). */
export function extractJson(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch { /* fall through */ } }
  return null;
}

function toDataUrl(f) {
  return `data:${f.mimeType};base64,${f.data.toString('base64')}`;
}

/**
 * Structured extraction from files/text on an OpenAI-compatible service: JSON schema output where the service has it,
 * plain JSON with the schema in the prompt otherwise (or when the model refuses response_format), validated by zod.
 */
async function structuredWithCompat({ files = [], text = '', system, jsonSchema, zodSchema, name = 'result', instruction, tier = 'main', language }) {
  const cfg = llmConfig();
  const ask = instruction || prompt(language, 'structuredInstruction');
  const schemaLabel = prompt(language, 'jsonSchemaLabel');
  const prepared = await filesForModel(files, cfg.caps, { ocrImages: true, language });
  const content = [];
  for (const f of prepared.pdfs) content.push({ type: 'file', file: { filename: f.name || 'document.pdf', file_data: toDataUrl(f) } });
  for (const f of prepared.imgs) content.push({ type: 'image_url', image_url: { url: toDataUrl(f) } });
  if (prepared.text) content.push({ type: 'text', text: prepared.text });
  if (text.trim()) content.push({ type: 'text', text: text.trim() });
  if (!content.length) {
    const e = new Error('nothing to parse');
    e.code = 'empty';
    throw e;
  }
  content.push({ type: 'text', text: cfg.caps.schema ? ask : `${ask}\n${schemaLabel}\n${JSON.stringify(jsonSchema)}` });
  const messages = [{ role: 'system', content: system }, { role: 'user', content }];
  const model = tier === 'fast' ? cfg.modelFast : cfg.model;

  let out;
  if (!cfg.caps.schema) out = await chatCompletions({ messages, model });
  else {
    try {
      out = await chatCompletions({ messages, model, responseFormat: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } } });
    } catch (e) {
      // Models without structured output support: ask for JSON in plain text instead.
      if (e.code === 'provider' && e.status >= 400 && e.status < 500 && /response_format|json_schema|structured/i.test(e.message)) {
        messages[1].content[messages[1].content.length - 1].text += `\n${schemaLabel}\n${JSON.stringify(jsonSchema)}`;
        out = await chatCompletions({ messages, model });
      } else throw e;
    }
  }
  if (out.finish === 'content_filter') {
    const e = new Error('model refused');
    e.code = 'refusal';
    throw e;
  }
  const raw = extractJson(out.text);
  const parsed = raw ? zodSchema.safeParse(raw) : { success: false };
  if (!parsed.success) {
    const e = new Error('could not parse structured output');
    e.code = 'bad_output';
    throw e;
  }
  return { data: parsed.data, usage: { input_tokens: out.usage.prompt_tokens, output_tokens: out.usage.completion_tokens, input: out.usage.prompt_tokens, output: out.usage.completion_tokens }, model: out.model };
}

/** Provider-agnostic structured extraction. args: { files, text, system, jsonSchema, zodSchema, name, instruction, tier, language } */
export async function parseStructured(args) {
  const cfg = llmConfig();
  if (!cfg.enabled) throw noKey();
  if (cfg.provider === 'anthropic') {
    const { parseStructuredWithClaude } = await import('./claude.js');
    return parseStructuredWithClaude({ ...args, model: args.tier === 'fast' ? cfg.modelFast : cfg.model });
  }
  return structuredWithCompat(args);
}

export async function parseImagingReport(args) {
  const { enabled } = llmConfig();
  if (!enabled) throw noKey();
  let text = args.text || '';
  const language = args.userId ? await languageOf(args.userId) : undefined;
  const dataHead = tr(language, 'aiContext.ask.patientData');
  if (args.userId) {
    const profile = await buildPatientProfile(args.userId, { language }).catch(() => '');
    if (profile) text = `${tr(language, 'aiContext.ask.patientDataForContext')}\n${profile}\n\n${text}`;
  }
  if (text.trim()) text = text.startsWith(dataHead) ? text : `${prompt(language, 'reportTextLabel')}\n\n${text.trim()}`;
  const r = await parseStructured({ files: args.files, text, system: imagingSystem(language), jsonSchema: imagingJsonSchema(language), zodSchema: imagingReport(language), name: 'imaging_report', instruction: prompt(language, 'imagingParseInstruction'), language });
  return { report: r.data, usage: r.usage, model: r.model };
}

/** Plain text completion for either provider: { text, usage, model }. */
export function promptTag(system) {
  return `prompt:${PROMPT_VERSION}:${createHash('sha256').update(String(system)).digest('hex').slice(0, 8)}`;
}

/**
 * Plain text completion for either provider: { text, usage:{input,output,cacheRead}, model, truncated, promptTag }.
 * The system prompt and (when long) the data part of the user message are marked cacheable so
 * repeated calls within a few minutes reuse the provider's prompt cache (Anthropic-style cache_control,
 * passed through by OpenRouter for Anthropic models and ignored by others).
 */
export async function llmChat({ system, user, images = [], files = [], maxTokens = 2000, timeoutMs = 180_000, tier = 'main', language }) {
  const cfg = llmConfig();
  const { provider, enabled } = cfg;
  if (!enabled) throw noKey();
  const model = tier === 'fast' ? cfg.modelFast : cfg.model;
  const imgs = images.filter((f) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimeType)).slice(0, 6);
  const pdfs = files.filter((f) => f.mimeType === 'application/pdf').slice(0, 3);
  const cacheable = String(user).length > 2000;
  const tag = promptTag(system);
  if (provider === 'anthropic') {
    const { claudeClient } = await import('./claude.js');
    const content = [...pdfs.map((f) => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data.toString('base64') } })), ...imgs.map((f) => ({ type: 'image', source: { type: 'base64', media_type: f.mimeType, data: f.data.toString('base64') } })), { type: 'text', text: user, ...(cacheable ? { cache_control: { type: 'ephemeral' } } : {}) }];
    const r = await claudeClient().messages.create({ model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] });
    return { text: r.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') || '', usage: { input: r.usage?.input_tokens, output: r.usage?.output_tokens, cacheRead: r.usage?.cache_read_input_tokens || 0 }, model: r.model, truncated: r.stop_reason === 'max_tokens', promptTag: tag };
  }
  const prepared = await filesForModel([...pdfs, ...imgs], cfg.caps, { language });
  const userBlock = { type: 'text', text: prepared.text ? `${prepared.text}\n\n${user}` : user, ...(cacheable ? { cache_control: { type: 'ephemeral' } } : {}) };
  const content = [...prepared.pdfs.map((f) => ({ type: 'file', file: { filename: f.name || 'document.pdf', file_data: toDataUrl(f) } })), ...prepared.imgs.map((f) => ({ type: 'image_url', image_url: { url: toDataUrl(f) } })), userBlock];
  const systemMsg = { role: 'system', content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] };
  const r = await chatCompletions({ messages: [systemMsg, { role: 'user', content }], maxTokens, timeoutMs, model });
  return { text: r.text, usage: { input: r.usage.prompt_tokens, output: r.usage.completion_tokens, cacheRead: r.usage.prompt_tokens_details?.cached_tokens || 0 }, model: r.model, truncated: r.finish === 'length', promptTag: tag };
}

/** Short round-trip to confirm the key and model id work. */
export async function llmPing(tier = 'main', language) {
  const question = prompt(language, 'pingQuestion');
  const cfg = llmConfig();
  const { provider, enabled } = cfg;
  const model = tier === 'fast' ? cfg.modelFast : cfg.model;
  if (!enabled) throw noKey();
  const t0 = Date.now();
  if (provider === 'anthropic') {
    const { claudeClient } = await import('./claude.js');
    const r = await claudeClient().messages.create({ model, max_tokens: 20, messages: [{ role: 'user', content: question }] });
    return { provider, tier, model: r.model, reply: r.content?.[0]?.text || '', ms: Date.now() - t0 };
  }
  const r = await chatCompletions({ messages: [{ role: 'user', content: question }], maxTokens: 20, timeoutMs: 30_000, model });
  return { provider, tier, model: r.model, reply: r.text, ms: Date.now() - t0 };
}

/** OpenRouter model catalog search (no key needed) to help pick LLM_MODEL. */
export async function openrouterModels(q = '') {
  const r = await egressFetch(`${OPENROUTER_URL}/models`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw Object.assign(new Error(`openrouter models ${r.status}`), { code: 'provider' });
  const j = await r.json();
  const needle = q.trim().toLowerCase();
  return (j.data || [])
    .filter((m) => !needle || m.id.toLowerCase().includes(needle) || (m.name || '').toLowerCase().includes(needle))
    .map((m) => ({
      id: m.id, name: m.name, context: m.context_length,
      input: m.architecture?.input_modalities || [],
      promptPrice: m.pricing?.prompt != null ? Number(m.pricing.prompt) * 1e6 : null,
      completionPrice: m.pricing?.completion != null ? Number(m.pricing.completion) * 1e6 : null,
    }))
    .slice(0, 30);
}
