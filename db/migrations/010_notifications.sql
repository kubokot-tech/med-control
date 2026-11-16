-- 010_notifications.sql
-- Log of sent notifications (Telegram) so reminders are not repeated.
create table if not exists notifications (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references users(id) on delete cascade,
  kind     text not null,      -- dose | dose_again | alert | labs_stale | test
  ref      text not null,      -- day key or alert id
  channel  text not null default 'telegram',
  text     text,
  sent_at  timestamptz not null default now(),
  unique (user_id, kind, ref)
);
