/** Runtime settings stored in app_settings; loaded once at start, kept in memory. */
// db.js is imported lazily so pure modules (llm.js) stay importable without a database.
const cache = new Map();
const db = () => import('./db.js').then((m) => m.pool);

export async function loadSettings() {
  const r = await (await db()).query('select key, value from app_settings');
  cache.clear();
  for (const row of r.rows) cache.set(row.key, row.value);
  return cache.size;
}
export function getSetting(key) {
  return cache.get(key) ?? null;
}
export async function setSetting(key, value) {
  if (key === 'anamnesis') { const { invalidateProfileCache } = await import('./patientProfile.js'); invalidateProfileCache(); }
  await writeSetting(await db(), key, value);
  cacheSetting(key, value);
}

async function writeSetting(client, key, value) {
  if (value == null || value === '') {
    await client.query('delete from app_settings where key=$1', [key]);
  } else {
    await client.query('insert into app_settings (key, value) values ($1,$2) on conflict (key) do update set value=excluded.value, updated_at=now()', [key, String(value)]);
  }
}

function cacheSetting(key, value) {
  if (value == null || value === '') cache.delete(key);
  else cache.set(key, String(value));
}

/** Return only committed credentials to the cache used by request authentication. */
export async function updateAuthSettings(fn) {
  const { transaction } = await import('./db.js');
  const changes = new Map();
  const result = await transaction(async (client) => {
    const set = async (key, value) => {
      await writeSetting(client, key, value);
      changes.set(key, value);
    };
    return fn(client, set);
  });
  for (const [key, value] of changes) cacheSetting(key, value);
  return result;
}
