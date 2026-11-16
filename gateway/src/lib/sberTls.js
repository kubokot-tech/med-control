/**
 * TLS for GigaChat. Sber's servers are signed by the Russian Trusted Root CA of the Ministry of Digital Development,
 * which Node.js (like Chrome, Firefox and Safari) does not trust. The certificate ships with the code
 * (src/certs/russian_trusted_root_ca.pem, from gosuslugi.ru/crt) and is trusted only for Sber's GigaChat hosts:
 * every other connection of the gateway keeps the usual roots. No NODE_EXTRA_CA_CERTS needed.
 */
import fs from 'node:fs';
import tls from 'node:tls';
import { Agent } from 'undici';

export const RU_CA_FILE = new URL('../certs/russian_trusted_root_ca.pem', import.meta.url);
/** SHA-256 of the certificate as published by the Ministry; checked by test/sberTls.test.js. */
export const RU_CA_SHA256 = 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31';
export const SBER_HOSTS = new Set(['ngw.devices.sberbank.ru', 'gigachat.devices.sberbank.ru']);

let agent = null;
function sberAgent() {
  if (!agent) agent = new Agent({ connect: { ca: [...tls.rootCertificates, fs.readFileSync(RU_CA_FILE, 'utf8')] } });
  return agent;
}

/** fetch() that adds the Ministry's root to the trusted ones, for Sber's GigaChat hosts only. */
export function sberFetch(url, init = {}, fetchImpl = fetch) {
  if (!SBER_HOSTS.has(new URL(url).hostname)) return fetchImpl(url, init);
  return fetchImpl(url, { ...init, dispatcher: sberAgent() });
}
