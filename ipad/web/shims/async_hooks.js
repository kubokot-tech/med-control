// The browser has no async context (AsyncContext is not shipped anywhere yet). This stand-in has one slot for the
// whole page: a second request that runs while a transaction is open joins that transaction. Gateway calls are
// serialized (web/gate.js) so only one request is in the slot at a time.
export class AsyncLocalStorage {
  #store; #depth = 0;
  getStore() { return this.#depth > 0 ? this.#store : undefined; }
  run(store, fn, ...args) {
    const prev = this.#store; const prevDepth = this.#depth;
    this.#store = store; this.#depth++;
    let r;
    try { r = fn(...args); } catch (e) { this.#store = prev; this.#depth = prevDepth; throw e; }
    if (r && typeof r.then === 'function') return r.finally(() => { this.#store = prev; this.#depth = prevDepth; });
    this.#store = prev; this.#depth = prevDepth;
    return r;
  }
  enterWith(store) { this.#store = store; this.#depth++; }
  disable() { this.#store = undefined; this.#depth = 0; }
}
export class AsyncResource { constructor() {} runInAsyncScope(fn, thisArg, ...args) { return fn.apply(thisArg, args); } emitDestroy() { return this; } asyncId() { return 0; } triggerAsyncId() { return 0; } bind(fn) { return fn; } static bind(fn) { return fn; } }
export const executionAsyncId = () => 0;
export const createHook = () => ({ enable() { return this; }, disable() { return this; } });
export default { AsyncLocalStorage, AsyncResource, executionAsyncId, createHook };
