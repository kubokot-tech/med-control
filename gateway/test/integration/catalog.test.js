import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, setupDb } from './helpers.js';

let db;
before(async () => { if (!SKIP) db = await setupDb('catalog'); });
after(async () => { if (db) await db.teardown(); });

test('the catalog is written once; a start with nothing changed writes nothing', { skip: SKIP }, async () => {
  const { loadCatalog, catalog } = await import('../../src/lib/canonical.js');
  const total = (await db.pool.query('select count(*)::int as n from lab_catalog')).rows[0].n;
  assert.ok(total > 50 && total === catalog().length, 'setupDb loaded every seed entry');
  assert.equal(await loadCatalog(db.pool), 0);
});

test('a changed or missing row is brought back to the seed, and only that one', { skip: SKIP }, async () => {
  const { loadCatalog } = await import('../../src/lib/canonical.js');
  await db.pool.query(`update lab_catalog set name_ru = 'old name', ref_high_default = 999, aliases = '{}' where key = 'ALT'`);
  await db.pool.query(`delete from lab_catalog where key = 'HGB'`);
  assert.equal(await loadCatalog(db.pool), 2);
  const alt = (await db.pool.query(`select name_ru, ref_high_default, aliases from lab_catalog where key = 'ALT'`)).rows[0];
  assert.notEqual(alt.name_ru, 'old name');
  assert.notEqual(Number(alt.ref_high_default), 999);
  assert.ok(alt.aliases.length > 0);
  assert.equal((await db.pool.query(`select count(*)::int as n from lab_catalog where key = 'HGB'`)).rows[0].n, 1);
  assert.equal(await loadCatalog(db.pool), 0);
});
