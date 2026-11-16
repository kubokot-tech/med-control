-- 012_ai.sql
-- Runtime settings editable from the UI (override .env) and AI commentary on records.
create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

create table if not exists ai_comments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  subject_type text not null,          -- lab_document
  subject_id   text not null,
  model        text,
  text         text not null,
  usage        jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists ai_comments_subject_idx on ai_comments(user_id, subject_type, subject_id, created_at desc);
