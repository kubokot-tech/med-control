import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, USER_ID, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('contacts'); });
after(async () => { if (db) await db.teardown(); });

test('contacts: create, list pinned first, update a part, delete; missing ones are not_found', { skip: SKIP }, async () => {
  const c = await import('../../src/lib/contacts.js');
  const a = await c.createContact(USER_ID, { name: 'Яковлева Анна', role: 'онколог', phones: ['+7 000 000-00-01'] });
  const b = await c.createContact(USER_ID, { name: 'Регистратура', clinic: 'Онкоцентр', pinned: true });
  assert.deepEqual((await c.listContacts(USER_ID)).map((x) => x.name), ['Регистратура', 'Яковлева Анна']);
  const up = await c.updateContact(USER_ID, a.id, { email: 'doc@example.com' });
  assert.equal(up.email, 'doc@example.com');
  assert.deepEqual(up.phones, ['+7 000 000-00-01'], 'fields not in the patch stay');
  await c.deleteContact(USER_ID, b.id);
  assert.equal((await c.listContacts(USER_ID)).length, 1);
  const missing = (e) => e.name === 'CoreError' && e.kind === 'not_found';
  await assert.rejects(c.deleteContact(USER_ID, b.id), missing);
  await assert.rejects(c.updateContact(USER_ID, b.id, { name: 'x' }), missing);
});
