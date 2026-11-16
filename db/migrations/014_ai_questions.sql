-- 014_ai_questions.sql
-- Follow-up questions to the AI about a record (lab document, monthly review, imaging study), with answers.
create table if not exists ai_questions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  subject_type text not null,           -- lab_document | labs_month | imaging_study
  subject_id   text not null,
  question     text not null,
  answer       text not null,
  model        text,
  usage        jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists ai_questions_subject_idx on ai_questions(user_id, subject_type, subject_id, created_at);
