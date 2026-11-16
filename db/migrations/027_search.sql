-- 027_search.sql
-- Full-text search across records (Russian stemming) with expression GIN indexes.
create index if not exists notes_fts_idx on notes using gin (to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(body, '')));
create index if not exists milestones_fts_idx on milestones using gin (to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(notes, '')));
create index if not exists attachment_extracts_fts_idx on attachment_extracts using gin (to_tsvector('russian', coalesce(summary, '') || ' ' || coalesce(text, '')));
create index if not exists imaging_studies_fts_idx on imaging_studies using gin (to_tsvector('russian', coalesce(modality, '') || ' ' || coalesce(body_region, '') || ' ' || coalesce(impression_text, '')));
create index if not exists appointments_fts_idx on appointments using gin (to_tsvector('russian', coalesce(doctor, '') || ' ' || coalesce(place, '') || ' ' || coalesce(notes, '') || ' ' || coalesce(questions, '')));
create index if not exists symptom_entries_fts_idx on symptom_entries using gin (to_tsvector('russian', coalesce(notes, '')));
create index if not exists ai_comments_fts_idx on ai_comments using gin (to_tsvector('russian', text));
create index if not exists ai_questions_fts_idx on ai_questions using gin (to_tsvector('russian', question || ' ' || answer));
create index if not exists infusion_sessions_fts_idx on infusion_sessions using gin (to_tsvector('russian', coalesce(notes, '') || ' ' || coalesce(reaction, '') || ' ' || coalesce(place, '')));
