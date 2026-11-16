-- 006_symptoms_extend.sql
-- Targeted-therapy side-effect scales (diarrhea, hand-foot syndrome) missing from the MVP diary.
alter table symptom_entries
  add column if not exists wellbeing  integer,   -- 1..5 overall
  add column if not exists diarrhea   integer,   -- 0..3
  add column if not exists hand_foot  integer,   -- 0..3 hand-foot skin reaction
  add column if not exists updated_at timestamptz not null default now();
