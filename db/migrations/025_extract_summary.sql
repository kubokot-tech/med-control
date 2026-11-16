-- 025_extract_summary.sql
-- A short annotation of an attachment next to its full text («кратко» vs «подробно»).
alter table attachment_extracts add column if not exists summary text, add column if not exists summary_model text, add column if not exists summary_at timestamptz;
