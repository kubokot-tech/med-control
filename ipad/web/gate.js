// One gateway operation at a time. The browser stand-in for AsyncLocalStorage has a single slot, so a second
// request that starts while a transaction is open runs inside that transaction and is rolled back with it.
let tail = Promise.resolve();

export function gate(fn) {
  const run = tail.then(fn, fn);
  tail = run.then(() => {}, () => {});
  return run;
}
