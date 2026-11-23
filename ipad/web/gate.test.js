import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from './shims/async_hooks.js';
import { gate } from './gate.js';

// The same shape as the PGlite pool: a query that sees an open store joins that transaction instead of waiting.
function harness() {
  const owner = new AsyncLocalStorage();
  const inside = () => owner.getStore()?.open === true;
  const events = [];
  async function transaction(name, fn) {
    const tx = { open: true, name };
    try {
      return await owner.run(tx, async () => {
        events.push(`begin ${name}`);
        await fn();
        events.push(`commit ${name}`);
      });
    } finally { tx.open = false; }
  }
  async function query(name) {
    await Promise.resolve();
    events.push(inside() ? `join ${name} -> ${owner.getStore().name}` : `own ${name}`);
  }
  return { events, transaction, query };
}

test('a second request joins an open transaction through the shim', async () => {
  const { events, transaction, query } = harness();
  await Promise.all([
    transaction('A', async () => { await Promise.resolve(); await query('A'); }),
    query('B'),
  ]);
  assert.deepEqual(events, ['begin A', 'join B -> A', 'join A -> A', 'commit A']);
});

test('the gateway queue keeps the second request out of the transaction', async () => {
  const { events, transaction, query } = harness();
  await Promise.all([
    gate(() => transaction('A', async () => { await Promise.resolve(); await query('A'); })),
    gate(() => query('B')),
  ]);
  assert.deepEqual(events, ['begin A', 'join A -> A', 'commit A', 'own B']);
});

test('a request that fails still lets the next one through', async () => {
  const seen = [];
  const first = gate(async () => { throw new Error('boom'); });
  const second = gate(async () => { seen.push('second'); });
  await assert.rejects(first, /boom/);
  await second;
  assert.deepEqual(seen, ['second']);
});
