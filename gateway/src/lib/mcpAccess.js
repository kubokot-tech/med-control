/**
 * Who may use the MCP endpoint (docs/MCP.md): the switch in Settings (off by default; DTC_MCP=off in .env forbids it
 * altogether), per-agent tokens with a scope (read or read+write; only the hash is stored), the audit log, a rate limit.
 */
import { createHash, randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { invalid, conflict, notFound } from './errors.js';

export const MAX_TOKENS = 10;
const RATE_PER_MIN = 120;
const hash = (t) => createHash('sha256').update(String(t)).digest('hex');

export const mcpDisabledByAdmin = () => String(process.env.DTC_MCP || '').toLowerCase() === 'off';
export const mcpEnabled = () => !mcpDisabledByAdmin() && getSetting('mcp_enabled') === '1';

/**
 * Switch MCP on (only with the user's explicit acknowledgement of the data-protection warning) or off. Switching off
 * revokes every token, so switching on again never silently brings back an old agent.
 */
export async function setMcpEnabled(userId, on, { acknowledged = false } = {}) {
  if (on) {
    if (mcpDisabledByAdmin()) throw conflict('mcp_disabled_by_admin');
    if (acknowledged !== true) throw invalid('mcp_ack_required');
    await setSetting('mcp_enabled', '1');
    await setSetting('mcp_enabled_at', new Date().toISOString());
  } else {
    await setSetting('mcp_enabled', '');
    await revokeAllTokens(userId);
  }
  return mcpEnabled();
}

/** Revoke every live token of the user (MCP off, «Выйти везде», a new password). */
export async function revokeAllTokens(userId) {
  await pool.query('update mcp_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
}

const toToken = (r) => ({ id: r.id, name: r.name, scope: r.scope, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at });

export async function listTokens(userId) {
  const r = await pool.query('select * from mcp_tokens where user_id = $1 order by revoked_at is not null, created_at desc limit 50', [userId]);
  return r.rows.map(toToken);
}

/** A new agent token: returned once, stored as a hash. */
export async function createToken(userId, { name, scope = 'read' }) {
  if (!mcpEnabled()) throw conflict('mcp_off');
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw invalid('invalid_body');
  if (!['read', 'write'].includes(scope)) throw invalid('invalid_body');
  const active = await pool.query('select count(*)::int as n from mcp_tokens where user_id = $1 and revoked_at is null', [userId]);
  if (active.rows[0].n >= MAX_TOKENS) throw conflict('mcp_too_many_tokens');
  const token = `mcp_${randomBytes(32).toString('base64url')}`;
  const r = await pool.query('insert into mcp_tokens (user_id, name, scope, token_hash) values ($1,$2,$3,$4) returning *', [userId, n, scope, hash(token)]);
  return { token, info: toToken(r.rows[0]) };
}

export async function revokeToken(userId, id) {
  const r = await pool.query('update mcp_tokens set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and id = $2 returning id', [userId, id]);
  if (!r.rows.length) throw notFound();
}

/** The live token row for a bearer value, or null. Marks it used. */
export async function verifyToken(token) {
  if (!/^mcp_[A-Za-z0-9_-]{40,}$/.test(String(token || ''))) return null;
  const r = await pool.query('update mcp_tokens set last_used_at = now() where token_hash = $1 and revoked_at is null returning id, user_id, name, scope', [hash(token)]);
  return r.rows[0] || null;
}

// per-token calls in the current minute
const windows = new Map();
export function rateLimited(tokenId, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const w = windows.get(tokenId);
  if (!w || w.minute !== minute) { windows.set(tokenId, { minute, n: 1 }); return false; }
  w.n += 1;
  return w.n > RATE_PER_MIN;
}

export async function audit(userId, tokenId, { method, tool = null, ok, detail = null }) {
  await pool.query('insert into mcp_audit (user_id, token_id, method, tool, ok, detail) values ($1,$2,$3,$4,$5,$6)', [userId, tokenId, method, tool, ok, detail]).catch(() => {});
}

export async function listAudit(userId, limit = 50) {
  const r = await pool.query(`select a.at, a.method, a.tool, a.ok, a.detail, t.name as token_name from mcp_audit a left join mcp_tokens t on t.id = a.token_id
                              where a.user_id = $1 order by a.at desc limit $2`, [userId, limit]);
  return r.rows.map((x) => ({ at: x.at, method: x.method, tool: x.tool, ok: x.ok, detail: x.detail, token: x.token_name }));
}
