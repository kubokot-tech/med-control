import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { llmConfig, llmChat, llmPing } from '../src/lib/llm.js';
import { validBaseUrl, PROVIDERS } from '../src/lib/llmProviders.js';

const KEYS = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_MODEL_FAST', 'LLM_BASE_URL', 'YANDEX_FOLDER_ID', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'YANDEX_API_KEY', 'GIGACHAT_AUTH_KEY', 'LLM_CUSTOM_API_KEY', 'EGRESS_PROXY'];
function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  try { const r = fn(); return r instanceof Promise ? r.finally(restore) : (restore(), r); } catch (e) { restore(); throw e; }
}
/** fetch stub: records requests, answers from `reply(url, init)`. */
function stubFetch(reply) {
  const calls = []; const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init, body: init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body }); const r = reply(String(url), init); return new Response(JSON.stringify(r.json), { status: r.status || 200, headers: { 'content-type': 'application/json' } }); };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const OK = { json: { choices: [{ message: { content: 'готов' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 }, model: 'm' } };
const PDF = readFileSync(fileURLToPath(new URL('../../ingestion/tests/fixtures/pdf/rows.pdf', import.meta.url)));
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('every service is picked by its key, with its own default models', () => withEnv({}, () => {
  assert.equal(llmConfig().provider, 'none');
  process.env.DEEPSEEK_API_KEY = 'k';
  let c = llmConfig();
  assert.deepEqual([c.provider, c.model, c.enabled, c.caps.pdf], ['deepseek', 'deepseek-chat', true, false]);
  process.env.OPENAI_API_KEY = 'k';
  c = llmConfig();
  assert.deepEqual([c.provider, c.model, c.modelFast], ['openai', 'gpt-5', 'gpt-5-mini'], 'ChatGPT comes before DeepSeek');
  process.env.LLM_PROVIDER = 'deepseek';
  assert.equal(llmConfig().provider, 'deepseek', 'an explicit choice wins');
}));

test('YandexGPT needs the cloud folder; it goes into the model id', () => withEnv({ LLM_PROVIDER: 'yandex', YANDEX_API_KEY: 'k' }, () => {
  assert.equal(llmConfig().enabled, false);
  process.env.YANDEX_FOLDER_ID = 'b1gfolder';
  const c = llmConfig();
  assert.deepEqual([c.enabled, c.model, c.modelFast], [true, 'gpt://b1gfolder/yandexgpt/latest', 'gpt://b1gfolder/yandexgpt-lite/latest']);
}));

test('your own address: an http(s) URL and a model, the key is optional', () => withEnv({ LLM_PROVIDER: 'custom', LLM_BASE_URL: 'http://192.168.1.10:11434/v1/' }, () => {
  assert.equal(llmConfig().enabled, false, 'no model yet');
  process.env.LLM_MODEL = 'qwen3:14b';
  const c = llmConfig();
  assert.deepEqual([c.enabled, c.baseUrl, c.modelFast], [true, 'http://192.168.1.10:11434/v1', 'qwen3:14b']);
  assert.equal(validBaseUrl('ftp://x'), null);
  assert.equal(validBaseUrl('http://user:pw@host/v1'), null);
  assert.equal(validBaseUrl('not a url'), null);
}));

test('an OpenAI-compatible service gets plain messages, a PDF as its text, no OpenRouter fields', () => withEnv({ LLM_PROVIDER: 'custom', LLM_BASE_URL: 'http://ollama.lan:11434/v1', LLM_MODEL: 'local' }, async () => {
  const f = stubFetch(() => OK);
  try {
    const r = await llmChat({ system: 'система', user: 'вопрос', files: [{ mimeType: 'application/pdf', name: 'бланк.pdf', data: PDF }] });
    assert.equal(r.text, 'готов');
    const { url, init, body } = f.calls[0];
    assert.equal(url, 'http://ollama.lan:11434/v1/chat/completions');
    assert.equal(init.headers.authorization, undefined, 'no key, no Authorization');
    assert.equal(body.model, 'local');
    assert.equal(typeof body.messages[0].content, 'string');
    assert.equal(typeof body.messages[1].content, 'string');
    assert.match(body.messages[1].content, /Текст документа «бланк\.pdf»/);
    assert.match(body.messages[1].content, /вопрос$/);
    assert.ok(!('provider' in body) && !('reasoning' in body));
    assert.ok(!JSON.stringify(body).includes('cache_control'));
    await assert.rejects(llmChat({ system: 's', user: 'u', images: [{ mimeType: 'image/png', data: PNG }] }), (e) => e.code === 'model_no_files');
  } finally { f.restore(); }
}));

test('a service without vision gets scans and photos of documents as recognised text; CT slices are still refused', () => withEnv({ LLM_PROVIDER: 'custom', LLM_BASE_URL: 'http://ollama.lan:11434/v1', LLM_MODEL: 'local' }, async () => {
  const SCAN = readFileSync(fileURLToPath(new URL('./fixtures/scan-rows.jpg', import.meta.url)));
  const PDFDocument = (await import('pdfkit')).default;
  const scanPdf = await new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 }); const ch = [];
    doc.on('data', (c) => ch.push(c)); doc.on('end', () => resolve(Buffer.concat(ch)));
    doc.image(SCAN, 0, 0, { width: 595 }); doc.end();
  });
  const empty = { json: { choices: [{ message: { content: '{"lab_name":null,"doc_date":null,"observations":[],"warnings":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 }, model: 'm' } };
  const f = stubFetch((url, init) => (String(init.body).includes('"response_format"') || String(init.body).includes('JSON') ? empty : OK));
  try {
    await llmChat({ system: 's', user: 'вопрос', files: [{ mimeType: 'application/pdf', name: 'скан.pdf', data: scanPdf }] });
    assert.match(f.calls[0].body.messages[1].content, /Текст документа «скан\.pdf»:\n[\s\S]*Гемоглобин 132/);
    const { parseLabsWithAi } = await import('../src/lib/labsAiParse.js');
    await parseLabsWithAi({ buf: SCAN, filename: 'бланк.jpg', mimeType: 'image/jpeg' });
    assert.match(JSON.stringify(f.calls[1].body.messages), /Текст, распознанный с изображения «бланк\.jpg»:[\s\S]*Гемоглобин 132/);
    await assert.rejects(llmChat({ system: 's', user: 'u', images: [{ mimeType: 'image/jpeg', data: SCAN }] }), (e) => e.code === 'model_no_files', 'a slice for the image explainer is not text');
  } finally { f.restore(); }
}));

test('ChatGPT: bearer key and max_completion_tokens', () => withEnv({ OPENAI_API_KEY: 'sk-test' }, async () => {
  // OpenAI goes through the egress helper: without EGRESS_PROXY that is the global fetch
  const f = stubFetch(() => OK);
  try {
    await llmPing();
    const { url, init, body } = f.calls[0];
    assert.equal(url, `${PROVIDERS.openai.baseUrl}/chat/completions`);
    assert.equal(init.headers.authorization, 'Bearer sk-test');
    assert.equal(body.max_completion_tokens, 20);
    assert.ok(!('max_tokens' in body));
  } finally { f.restore(); }
}));

test('GigaChat: OAuth token first, then the chat with it; the token is reused', () => withEnv({ GIGACHAT_AUTH_KEY: 'base64key' }, async () => {
  const f = stubFetch((url) => (url.includes('/oauth') ? { json: { access_token: 'tok', expires_at: Date.now() + 30 * 60_000 } } : OK));
  try {
    await llmPing(); await llmPing();
    const oauth = f.calls.filter((c) => c.url.includes('/oauth'));
    assert.equal(oauth.length, 1);
    assert.equal(oauth[0].init.headers.authorization, 'Basic base64key');
    assert.match(oauth[0].body, /scope=GIGACHAT_API_PERS/);
    const chat = f.calls.filter((c) => c.url.endsWith('/chat/completions'));
    assert.equal(chat.length, 2);
    assert.equal(chat[0].init.headers.authorization, 'Bearer tok');
    assert.equal(chat[0].body.model, 'GigaChat-2-Max');
  } finally { f.restore(); }
}));

test('«Свой адрес» may not point at the stack, cloud metadata, or — on the server — the gateway itself', () => {
  assert.equal(validBaseUrl('http://postgres:5432/v1', { desktop: false }), null);
  assert.equal(validBaseUrl('http://ingestion:8000/x', { desktop: false }), null);
  assert.equal(validBaseUrl('http://169.254.169.254/latest', { desktop: false }), null);
  assert.equal(validBaseUrl('http://127.0.0.1:11434/v1', { desktop: false }), null);
  assert.equal(validBaseUrl('http://127.0.0.1:11434/v1', { desktop: true }), 'http://127.0.0.1:11434/v1', 'a local model on the desktop');
  assert.equal(validBaseUrl('http://192.168.1.10:11434/v1', { desktop: false }), 'http://192.168.1.10:11434/v1');
});

test('«Свой адрес»: other spellings of the same forbidden places are refused too', () => {
  const no = (u, o = { desktop: false }) => assert.equal(validBaseUrl(u, o), null, u);
  // the stack's services: a trailing dot, capitals, the name inside a compose network, the container's own name
  for (const u of ['http://postgres.:5432/v1', 'http://POSTGRES/', 'http://gateway.:3000/', 'http://%70ostgres/', 'http://postgres.medcontrol_data/', 'http://medcontrol-gateway-1:3000/', 'http://dtc_orthanc_1:8042/']) no(u);
  for (const name of ['gateway', 'frontend', 'edge', 'postgres', 'orthanc', 'ingestion', 'backup', 'watchdog', 'egress']) { no(`http://${name}:3000/v1`); no(`http://${name}./v1`); }
  // «this host»: reaches the gateway itself
  for (const u of ['http://0.0.0.0:3000/', 'http://0/', 'http://0.1.2.3/', 'http://[::]:3000/', 'http://[::ffff:0.0.0.0]/']) { no(u); no(u, { desktop: true }); }
  // loopback in every spelling: only the desktop edition
  for (const u of ['http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::1]:11434/v1', 'http://[::ffff:127.0.0.1]:3000/', 'http://[::ffff:7f00:1]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://localhost.:11434/', 'http://LOCALHOST/', 'http://foo.localhost/']) {
    no(u);
    assert.notEqual(validBaseUrl(u, { desktop: true }), null, `${u} on the desktop`);
  }
  // link-local and cloud metadata, by address and by name
  for (const u of ['http://169.254.169.254/latest', 'http://169.254.0.1/', 'http://[::ffff:169.254.169.254]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fe80::1]/', 'http://[febf::1]/', 'http://[fd00:ec2::254]/', 'http://metadata.google.internal/', 'http://metadata.google.internal./', 'http://metadata/', 'http://100.100.100.200/', 'http://192.0.0.192/']) { no(u); no(u, { desktop: true }); }
});

test('«Свой адрес»: a model of one\'s own keeps working', () => {
  const yes = (u) => assert.equal(validBaseUrl(u, { desktop: false }), u, u);
  for (const u of [
    'http://192.168.1.10:11434/v1', 'http://10.0.0.5:1234/v1', 'http://172.20.0.9:8000/v1', // the home network
    'http://host.docker.internal:11434/v1', 'http://ollama:11434/v1', 'http://ollama.lan:11434/v1', 'http://lmstudio.local:1234/v1',
    'http://[fd12:3456::10]:11434/v1', 'https://llm.example.com/v1', 'http://gateway.lan/v1', 'http://my-edge-proxy.example.com/v1',
  ]) yes(u);
});
