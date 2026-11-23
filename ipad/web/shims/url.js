// node:url: file URLs map to paths of the in-memory file system (shims/fs.js), any other URL to its pathname.
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export function fileURLToPath(u) { return decodeURIComponent(new URL(String(u)).pathname); }
export function pathToFileURL(p) { return new URL(`file://${encodeURI(p)}`); }
export function format(u) { return String(u); }
export function parse(s) { const u = new URL(s, 'http://x'); return { ...u, query: u.search.slice(1), path: u.pathname + u.search }; }
export default { URL, URLSearchParams, fileURLToPath, pathToFileURL, format, parse };
