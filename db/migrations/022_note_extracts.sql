-- 022_note_extracts.sql
-- Text extracted from files attached to notes (PDF text layer or a model transcription), so the AI reads the files too.
create table if not exists note_extracts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  note_id     uuid not null references notes(id) on delete cascade,
  sha256      text not null,
  method      text not null,          -- pdf_text | llm
  model       text,
  text        text not null,
  created_at  timestamptz not null default now(),
  unique (note_id, sha256)
);
