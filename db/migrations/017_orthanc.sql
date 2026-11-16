-- 017_orthanc.sql
-- Link an imaging study to its DICOM study in Orthanc (viewer) and remember imported disc folders.
alter table imaging_studies add column if not exists orthanc_study_id text;
alter table imaging_studies add column if not exists study_instance_uid text;
create table if not exists dicom_imports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  folder      text not null,
  files       int not null default 0,
  imported    int not null default 0,
  studies     jsonb not null default '[]'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  error       text,
  unique (user_id, folder)
);
