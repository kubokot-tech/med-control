// node:module: createRequire(...).resolve() for the few package files the gateway locates on disk (pdf.js worker and fonts).
const ASSETS = {
  'pdfjs-dist/legacy/build/pdf.worker.mjs': '/assets/pdfjs/pdf.worker.mjs',
  'pdfjs-dist/package.json': '/assets/pdfjs/package.json',
};
export function createRequire() {
  const req = (id) => { throw new Error(`require(${id}) is not available in the browser bundle`); };
  req.resolve = (id) => { if (ASSETS[id]) return ASSETS[id]; throw new Error(`require.resolve(${id}) is not mapped in shims/module.js`); };
  return req;
}
export const builtinModules = [];
export default { createRequire, builtinModules };
