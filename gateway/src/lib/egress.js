/**
 * Outbound HTTP(S) through an optional proxy (EGRESS_PROXY, e.g. http://egress:8888).
 * Used for services blocked by geography: OpenRouter, Anthropic, Telegram.
 */
import { ProxyAgent } from 'undici';

let agent = null;
export function egressProxy() {
  return process.env.EGRESS_PROXY || '';
}
export function egressDispatcher() {
  const url = egressProxy();
  if (!url) return undefined;
  if (!agent) agent = new ProxyAgent(url);
  return agent;
}
/** fetch() that goes through the egress proxy when configured. */
export function egressFetch(url, init = {}) {
  const dispatcher = egressDispatcher();
  return fetch(url, dispatcher ? { ...init, dispatcher } : init);
}
/** Public address as seen by the outside world through the egress path. */
export async function egressPublicIp() {
  const r = await egressFetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`ipify ${r.status}`);
  return (await r.json()).ip;
}

/**
 * Telegram path: TELEGRAM_PROXY overrides EGRESS_PROXY for Telegram only. Set TELEGRAM_PROXY=direct
 * (or empty with TELEGRAM_DIRECT=1) to talk to api.telegram.org without the VPN proxy.
 */
let tgAgent = null;
export function telegramProxy() {
  const v = process.env.TELEGRAM_PROXY;
  if (v === 'direct' || process.env.TELEGRAM_DIRECT === '1') return '';
  return v || egressProxy();
}
export function telegramFetch(url, init = {}) {
  const p = telegramProxy();
  if (!p) return fetch(url, init);
  if (!tgAgent) tgAgent = new ProxyAgent(p);
  return fetch(url, { ...init, dispatcher: tgAgent });
}
