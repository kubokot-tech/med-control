-- 021_notes.sql
-- Research notes: the patient's own notebook about the disease (links, articles, thoughts, imported AI chats).
-- Each note is also a NOTE event (source 'notes') so files attach through the usual attachments table.
create table if not exists notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  event_id     uuid references events(id) on delete set null,
  title        text not null,
  body         text not null default '',          -- markdown
  tags         text[] not null default '{}',
  url          text,
  source       text not null default 'manual',   -- manual | import
  source_name  text,                             -- original file name or the AI that wrote it
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists notes_user_updated_idx on notes(user_id, pinned desc, updated_at desc);
create index if not exists notes_user_tags_idx on notes using gin (tags);
