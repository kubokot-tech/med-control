-- 034_mcp.sql
-- Access for AI agents over MCP (docs/MCP.md). Off unless switched on in Settings; each agent has its own token,
-- only the token's hash is stored; every call is written to the audit log.
create table if not exists mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null,
  scope        text not null default 'read' check (scope in ('read', 'write')),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists mcp_tokens_user_idx on mcp_tokens(user_id, created_at desc);

create table if not exists mcp_audit (
  id        bigserial primary key,
  user_id   uuid not null references users(id) on delete cascade,
  token_id  uuid references mcp_tokens(id) on delete set null,
  at        timestamptz not null default now(),
  method    text not null,              -- tools/call, tools/list, initialize…
  tool      text,
  ok        boolean not null,
  detail    text                        -- the error code, never the data
);
create index if not exists mcp_audit_user_idx on mcp_audit(user_id, at desc);
