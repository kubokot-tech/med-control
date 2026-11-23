/**
 * AI services MedControl can talk to (Settings → «Помощник ИИ»). OpenRouter and Anthropic as before; the rest speak the
 * OpenAI chat completions protocol: ChatGPT, DeepSeek, Alice AI / YandexGPT (Yandex Cloud), GigaChat (Sber) and any
 * address of your own (a local Ollama or LM Studio, a company proxy).
 *
 * caps: what the service accepts besides text. Without `pdf` a PDF goes as its text layer (scans then need a model that
 * reads images); without `images` pictures cannot be sent at all. `schema`: strict JSON schema output.
 * egress: whether requests go through the VPN proxy (EGRESS_PROXY); Russian services and local addresses go direct.
 */
import { parseIPv4, parseIPv6, embeddedIPv4 } from './ipAddr.js';
import { edition } from './edition.js';

export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter', kind: 'openrouter', secret: 'openrouterApiKey', baseUrl: 'https://openrouter.ai/api/v1',
    models: { main: 'anthropic/claude-opus-5', fast: 'anthropic/claude-sonnet-5' },
    caps: { pdf: true, images: true, schema: true }, egress: true, keyUrl: 'openrouter.ai/keys',
  },
  anthropic: {
    label: 'Anthropic (Claude)', kind: 'anthropic', secret: 'anthropicApiKey',
    models: { main: 'claude-opus-5', fast: 'claude-sonnet-5' },
    caps: { pdf: true, images: true, schema: true }, egress: true, keyUrl: 'platform.claude.com/settings/keys',
  },
  openai: {
    label: 'ChatGPT (OpenAI)', kind: 'compat', secret: 'openaiApiKey', baseUrl: 'https://api.openai.com/v1',
    models: { main: 'gpt-5', fast: 'gpt-5-mini' }, maxTokensParam: 'max_completion_tokens',
    caps: { pdf: true, images: true, schema: true }, egress: true, keyUrl: 'platform.openai.com/settings/organization/api-keys',
  },
  deepseek: {
    label: 'DeepSeek', kind: 'compat', secret: 'deepseekApiKey', baseUrl: 'https://api.deepseek.com/v1',
    models: { main: 'deepseek-chat', fast: 'deepseek-chat' },
    caps: { pdf: false, images: false, schema: false }, egress: true, keyUrl: 'platform.deepseek.com', note: 'servers_cn',
  },
  yandex: {
    label: 'Алиса AI (YandexGPT)', kind: 'compat', secret: 'yandexApiKey', baseUrl: 'https://llm.api.cloud.yandex.net/v1',
    models: { main: 'gpt://{folder}/yandexgpt/latest', fast: 'gpt://{folder}/yandexgpt-lite/latest' }, needsFolder: true,
    caps: { pdf: false, images: false, schema: false }, egress: false, keyUrl: 'console.yandex.cloud',
  },
  gigachat: {
    label: 'GigaChat (Сбер)', kind: 'compat', secret: 'gigachatAuthKey', baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1',
    models: { main: 'GigaChat-2-Max', fast: 'GigaChat-2' }, auth: 'gigachat',
    caps: { pdf: false, images: false, schema: false }, egress: false, keyUrl: 'developers.sber.ru',
  },
  custom: {
    label: 'Свой адрес (OpenAI-совместимый)', kind: 'compat', secret: 'customApiKey', keyOptional: true,
    models: { main: '', fast: '' }, caps: { pdf: false, images: false, schema: false }, egress: false,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
/** Order of the automatic choice when no service is picked: the first one with a key. */
export const AUTO_ORDER = ['openrouter', 'anthropic', 'openai', 'deepseek', 'yandex', 'gigachat'];

/** A model id of the provider with the Yandex Cloud folder filled in. */
export const fillModel = (m, { folder = '' } = {}) => String(m || '').replace('{folder}', folder);

// Names of the services of our own stack (docker-compose.yml): «Свой адрес» must not point the gateway at them.
const STACK_SERVICES = ['postgres', 'gateway', 'ingestion', 'orthanc', 'egress', 'edge', 'frontend', 'backup', 'watchdog'];
const STACK_HOSTS = new Set(STACK_SERVICES);
// The same containers by the names Docker also answers to: «medcontrol-postgres-1», «medcontrol_postgres_1».
const STACK_CONTAINER = new RegExp(`^[a-z0-9][a-z0-9_.-]*[-_](${STACK_SERVICES.join('|')})[-_]\\d+$`);
// Cloud metadata services by name; by address they are link-local or listed in METADATA_V4 below.
const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal']);
const METADATA_V4 = new Set(['100.100.100.200', '192.0.0.192']);

/** 'loopback' | 'blocked' | 'ok' for an IPv4 address as four numbers. */
function classifyV4(b) {
  if (b[0] === 127) return 'loopback';
  // 0.0.0.0/8 is «this host» (it reaches the gateway itself), 169.254/16 is link-local: cloud metadata lives there
  if (b[0] === 0 || (b[0] === 169 && b[1] === 254) || METADATA_V4.has(b.join('.'))) return 'blocked';
  return 'ok';
}

/** The same for a host name as the URL parser gives it: an IP address in any spelling, or a name. */
function classifyHost(hostname) {
  // a trailing dot is the same host («postgres.», «localhost.»)
  const h = String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!h) return 'blocked';
  const v4 = parseIPv4(h);
  if (v4) return classifyV4(v4);
  if (h.startsWith('[') || h.includes(':')) {
    const g = parseIPv6(h);
    if (!g) return 'blocked';
    // an IPv4 address inside an IPv6 one (::ffff:127.0.0.1, 64:ff9b::…) is judged as that IPv4 address
    const inner = embeddedIPv4(g);
    if (inner) return classifyV4(inner);
    if (g.every((x) => x === 0)) return 'blocked'; // «::», the IPv6 spelling of 0.0.0.0
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback';
    if ((g[0] & 0xffc0) === 0xfe80) return 'blocked'; // fe80::/10, link-local
    if (g[0] === 0xfd00 && g[1] === 0xec2) return 'blocked'; // fd00:ec2::/32, AWS metadata over IPv6
    return 'ok';
  }
  if (h === 'localhost' || h.endsWith('.localhost')) return 'loopback';
  // a service of the stack: its bare name, the name inside a compose network («postgres.medcontrol_data») or of its container
  const labels = h.split('.');
  if (STACK_HOSTS.has(labels[0]) && (labels.length === 1 || labels.slice(1).some((l) => l.includes('_')))) return 'blocked';
  if (STACK_CONTAINER.test(labels[0])) return 'blocked';
  if (METADATA_HOSTS.has(h)) return 'blocked';
  return 'ok';
}

/**
 * May «Свой адрес» point here? It is meant for a model of one's own: Ollama or LM Studio on the home network or on the
 * Docker host (host.docker.internal), a company proxy. Never the stack's own services, «this host» (0.0.0.0, ::) or
 * link-local and cloud metadata addresses, in whatever spelling: with a trailing dot, as an IPv4 address inside an
 * IPv6 one, by a container name. Loopback only in the desktop edition, where a local model (Ollama on 127.0.0.1) is
 * the point, while on the server it is the gateway itself.
 * A name that somebody's DNS resolves to an address of the stack is not caught here: no lookup is made.
 */
export function allowedCustomHost(hostname, { desktop = false } = {}) {
  const kind = classifyHost(hostname);
  return kind === 'ok' || (kind === 'loopback' && desktop);
}

/** http(s) URL without credentials, for «Свой адрес»; null when it is not one or points where it must not. */
export function validBaseUrl(s, { desktop = edition() === 'desktop' } = {}) {
  try {
    const u = new URL(String(s || '').trim());
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null;
    return allowedCustomHost(u.hostname, { desktop }) ? u.toString().replace(/\/$/, '') : null;
  } catch { return null; }
}
