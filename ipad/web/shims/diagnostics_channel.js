const ch = () => ({ hasSubscribers: false, publish() {}, subscribe() {}, unsubscribe() {}, bindStore() {}, runStores(_d, fn, thisArg, ...args) { return fn.apply(thisArg, args); } });
export const channel = ch;
export const hasSubscribers = () => false;
export const subscribe = () => {};
export const unsubscribe = () => {};
export function tracingChannel() {
  const c = { start: ch(), end: ch(), asyncStart: ch(), asyncEnd: ch(), error: ch(), hasSubscribers: false };
  c.traceSync = (fn, _ctx, thisArg, ...args) => fn.apply(thisArg, args);
  c.tracePromise = (fn, _ctx, thisArg, ...args) => fn.apply(thisArg, args);
  c.traceCallback = (fn, _pos, _ctx, thisArg, ...args) => fn.apply(thisArg, args);
  return c;
}
export default { channel, hasSubscribers, subscribe, unsubscribe, tracingChannel };
