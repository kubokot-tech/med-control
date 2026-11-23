// node:crypto for the browser bundle: the handful of calls the gateway makes, on Web Crypto and @noble/hashes.
import { Buffer } from 'buffer';
import { sha256, sha512, sha384, sha224 } from '@noble/hashes/sha2';
import { sha1, md5 } from '@noble/hashes/legacy';
import { hmac } from '@noble/hashes/hmac';
import { scrypt as nobleScrypt, scryptAsync } from '@noble/hashes/scrypt';

const HASHES = { sha256, sha512, sha384, sha224, sha1, md5 };
const algo = (name) => {
  const h = HASHES[String(name).toLowerCase().replace('-', '')];
  if (!h) throw new Error(`crypto shim: unsupported hash ${name}`);
  return h;
};
const bytes = (d, enc) => (typeof d === 'string' ? Buffer.from(d, enc || 'utf8') : d instanceof Uint8Array ? d : Buffer.from(d));
const out = (u8, enc) => { const b = Buffer.from(u8); return enc ? b.toString(enc) : b; };

function incremental(h) {
  return {
    update(d, enc) { h.update(bytes(d, enc)); return this; },
    digest(enc) { return out(h.digest(), enc); },
    copy() { return incremental(h.clone()); },
  };
}
export const createHash = (name) => incremental(algo(name).create());
export const createHmac = (name, key) => incremental(hmac.create(algo(name), bytes(key)));

export function randomBytes(n, cb) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  if (cb) { queueMicrotask(() => cb(null, b)); return undefined; }
  return b;
}
export const randomUUID = () => globalThis.crypto.randomUUID();
export function randomInt(min, max, cb) {
  if (max === undefined || typeof max === 'function') { cb = max; max = min; min = 0; }
  const range = max - min;
  const buf = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / range) * range;
  let v;
  do { globalThis.crypto.getRandomValues(buf); v = buf[0]; } while (v >= lim);
  const r = min + (v % range);
  if (cb) { queueMicrotask(() => cb(null, r)); return undefined; }
  return r;
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
const scryptOpts = (o = {}) => ({ N: o.N || o.cost || 16384, r: o.r || o.blockSize || 8, p: o.p || o.parallelization || 1, maxmem: o.maxmem || 2 ** 32 });
export const scryptSync = (pw, salt, keylen, o) => Buffer.from(nobleScrypt(bytes(pw), bytes(salt), { ...scryptOpts(o), dkLen: keylen }));
export function scrypt(pw, salt, keylen, o, cb) {
  if (typeof o === 'function') { cb = o; o = {}; }
  scryptAsync(bytes(pw), bytes(salt), { ...scryptOpts(o), dkLen: keylen }).then((k) => cb(null, Buffer.from(k)), (e) => cb(e));
}
// fast-jwt reads these at import; the session tokens are HS256, so the asymmetric calls are never made.
export const constants = { RSA_PKCS1_PSS_PADDING: 6, RSA_PSS_SALTLEN_DIGEST: -1, RSA_PKCS1_PADDING: 1, RSA_PSS_SALTLEN_MAX_SIGN: -2, RSA_PSS_SALTLEN_AUTO: -2 };
const noAsym = () => { throw new Error('crypto shim: asymmetric keys are not supported'); };
export const createSign = noAsym, createVerify = noAsym, createPublicKey = noAsym, createPrivateKey = noAsym, sign = noAsym, verify = noAsym;
export const createSecretKey = (k) => bytes(k);
export const webcrypto = globalThis.crypto;
export const getRandomValues = (a) => globalThis.crypto.getRandomValues(a);
export default { constants, createSign, createVerify, createPublicKey, createPrivateKey, sign, verify, createSecretKey, createHash, createHmac, randomBytes, randomUUID, randomInt, timingSafeEqual, scryptSync, scrypt, webcrypto, getRandomValues };
