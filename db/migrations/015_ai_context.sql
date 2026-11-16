-- 015_ai_context.sql
-- Keep the exact context the model saw next to its answer, so any number can be checked.
alter table ai_comments  add column if not exists context text;
alter table ai_questions add column if not exists context text;
