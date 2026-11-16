-- 011_passkeys.sql
-- WebAuthn credentials (passkeys) used as a second factor at login.
create table if not exists passkeys (
  id            text primary key,                 -- credential id, base64url
  user_id       uuid not null references users(id) on delete cascade,
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  device_type   text,                              -- singleDevice | multiDevice
  backed_up     boolean not null default false,
  name          text not null default 'Ключ',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists passkeys_user_idx on passkeys(user_id);
