// Modules the browser edition never uses at runtime (pg, tls, readline, net, undici's agents...): importable, inert.
const fail = (name) => () => { throw new Error(`${name} is not available in the browser edition`); };
export class Agent { constructor() {} }
export class ProxyAgent { constructor() {} }
export class Pool { constructor() { throw new Error('pg is not available in the browser edition'); } }
export const fetch = (...a) => globalThis.fetch(...a);
export const setGlobalDispatcher = () => {};
export const rootCertificates = [];
export const createInterface = fail('readline');
export const connect = fail('net');
export const createConnection = fail('net');
export const lookup = (h, o, cb) => (typeof o === 'function' ? o : cb)(new Error('dns not available'));
export const types = { setTypeParser() {} };
export default { Agent, ProxyAgent, Pool, fetch, setGlobalDispatcher, rootCertificates, createInterface, connect, createConnection, lookup, types };
