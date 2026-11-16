-- 023_attachment_extracts.sql
-- Extracted text for any attachment (notes, milestones, doctor reports), keyed by the file hash.
create table if not exists attachment_extracts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  sha256      text not null,
  method      text not null,          -- pdf_text | llm
  model       text,
  text        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, sha256)
);
insert into attachment_extracts (user_id, sha256, method, model, text, created_at)
select user_id, sha256, method, model, text, created_at from note_extracts
on conflict (user_id, sha256) do nothing;
drop table if exists note_extracts;
