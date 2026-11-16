/**
 * Doctors and other contacts (Ещё → «Врачи и контакты»): name, role, clinic, phones, e-mail, address, site, notes.
 * Inputs are validated by the caller (routes/contacts.js); a missing contact is CoreError not_found.
 */
import { pool } from './db.js';
import { notFound } from './errors.js';

const FIELDS = ['name', 'role', 'clinic', 'phones', 'email', 'address', 'url', 'notes', 'pinned'];

const toContact = (r) => ({
  id: r.id, name: r.name, role: r.role, clinic: r.clinic, phones: r.phones || [], email: r.email, address: r.address,
  url: r.url, notes: r.notes, pinned: r.pinned, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Pinned first, then by name. */
export async function listContacts(userId) {
  const r = await pool.query('select * from contacts where user_id = $1 order by pinned desc, lower(name)', [userId]);
  return r.rows.map(toContact);
}

export async function createContact(userId, c) {
  const r = await pool.query(
    `insert into contacts (user_id, name, role, clinic, phones, email, address, url, notes, pinned)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [userId, c.name, c.role ?? null, c.clinic ?? null, c.phones ?? [], c.email ?? null, c.address ?? null, c.url ?? null, c.notes ?? null, Boolean(c.pinned)]
  );
  return toContact(r.rows[0]);
}

export async function updateContact(userId, id, patch) {
  const keys = FIELDS.filter((k) => k in patch);
  if (!keys.length) {
    const r = await pool.query('select * from contacts where user_id = $1 and id = $2', [userId, id]);
    if (!r.rows.length) throw notFound();
    return toContact(r.rows[0]);
  }
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const r = await pool.query(`update contacts set ${sets}, updated_at = now() where user_id = $1 and id = $2 returning *`, [userId, id, ...keys.map((k) => patch[k] ?? (k === 'phones' ? [] : k === 'pinned' ? false : null))]);
  if (!r.rows.length) throw notFound();
  return toContact(r.rows[0]);
}

export async function deleteContact(userId, id) {
  const r = await pool.query('delete from contacts where user_id = $1 and id = $2', [userId, id]);
  if (!r.rowCount) throw notFound();
}
