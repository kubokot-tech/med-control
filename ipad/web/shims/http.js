// node:http for the page: client calls from stream-http, plus the server-side pieces Fastify and light-my-request
// (app.inject) use: STATUS_CODES, METHODS and a ServerResponse that only keeps headers and status.
import sh from 'stream-http';
import { Stream } from 'stream';
import { inherits } from 'util';

export const STATUS_CODES = sh.STATUS_CODES;
export const METHODS = sh.METHODS;
export const request = sh.request;
export const get = sh.get;
export const Agent = sh.Agent || function Agent() {};
export const globalAgent = sh.globalAgent || new Agent();
export const IncomingMessage = sh.IncomingMessage || function IncomingMessage() {};
export const createServer = () => { throw new Error('http.createServer is not available in the page'); };

export function ServerResponse(req) {
  Stream.call(this);
  this.req = req;
  this.statusCode = 200;
  this.statusMessage = undefined;
  this._hdrs = Object.create(null);
  this._names = Object.create(null);
  this._header = null;
  this.headersSent = false;
  this.finished = false;
  this.writableEnded = false;
  this.writableFinished = false;
  this.writable = true;
  this.sendDate = true;
  this.destroyed = false;
}
inherits(ServerResponse, Stream);
const P = ServerResponse.prototype;
P.setHeader = function (n, v) { const k = n.toLowerCase(); this._hdrs[k] = v; this._names[k] = n; return this; };
P.appendHeader = function (n, v) { const k = n.toLowerCase(); const cur = this._hdrs[k]; this.setHeader(n, cur === undefined ? v : [].concat(cur, v)); return this; };
P.getHeader = function (n) { return this._hdrs[n.toLowerCase()]; };
P.getHeaders = function () { return { ...this._hdrs }; };
P.getHeaderNames = function () { return Object.keys(this._hdrs); };
P.hasHeader = function (n) { return n.toLowerCase() in this._hdrs; };
P.removeHeader = function (n) { const k = n.toLowerCase(); delete this._hdrs[k]; delete this._names[k]; };
P.assignSocket = function (s) { this.socket = s; this.connection = s; };
P.detachSocket = function () { this.socket = null; this.connection = null; };
P.flushHeaders = function () { if (!this.headersSent) this.writeHead(this.statusCode); };
P.setTimeout = function () { return this; };
P.cork = function () {}; P.uncork = function () {};
P.writeHead = function (code, msg, headers) {
  if (typeof msg !== 'string') { headers = msg; msg = undefined; }
  this.statusCode = code;
  this.statusMessage = msg || this.statusMessage || STATUS_CODES[code] || 'unknown';
  if (Array.isArray(headers)) { for (let i = 0; i < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]); }
  else if (headers) for (const [k, v] of Object.entries(headers)) if (v !== undefined) this.setHeader(k, v);
  this.headersSent = true;
  this._header = `HTTP/1.1 ${code} ${this.statusMessage}\r\n${Object.entries(this._hdrs).map(([k, v]) => `${this._names[k]}: ${v}`).join('\r\n')}\r\n\r\n`;
  return this;
};
P.write = function (_data, _enc, cb) {
  if (typeof _enc === 'function') cb = _enc;
  if (!this.headersSent) this.writeHead(this.statusCode);
  if (cb) queueMicrotask(cb);
  return true;
};
P.end = function (cb) {
  if (typeof cb !== 'function') cb = undefined;
  if (!this.headersSent) this.writeHead(this.statusCode);
  this.finished = true; this.writableEnded = true; this.writableFinished = true; this.writable = false;
  if (cb) queueMicrotask(cb);
  return this;
};

export default { STATUS_CODES, METHODS, request, get, Agent, globalAgent, IncomingMessage, ServerResponse, createServer };
