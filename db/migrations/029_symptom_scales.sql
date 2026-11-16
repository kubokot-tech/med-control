-- 029_symptom_scales.sql
-- Diary scales beyond the nine historic columns (edema, dyspnea, joint pain…): the treatment protocol picks which
-- scales the diary shows; values of the extra ones live here as {"edema": 2, "dyspnea": 1}.
alter table symptom_entries
  add column if not exists scales jsonb not null default '{}'::jsonb;
