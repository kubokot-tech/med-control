-- 009_imaging.sql
-- Imaging studies linked to milestones, lesions and their measurements (RECIST 1.1).

alter table imaging_studies
  add column if not exists milestone_id uuid references milestones(id) on delete set null,
  add column if not exists study_date  date,
  add column if not exists response    text,          -- CR | PR | SD | PD | NA (radiologist's or user's call)
  add column if not exists dicom_path  text,          -- folder with the DICOM disc copy (outside the app)
  add column if not exists updated_at  timestamptz not null default now();
update imaging_studies set study_date = (performed_at at time zone 'Europe/Moscow')::date where study_date is null;
create index if not exists idx_imaging_user_date on imaging_studies(user_id, study_date desc);

create table if not exists lesions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null,
  location   text,
  is_target  boolean not null default true,
  retired    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_lesions_user on lesions(user_id);

create table if not exists lesion_measurements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  lesion_id  uuid not null references lesions(id) on delete cascade,
  study_id   uuid not null references imaging_studies(id) on delete cascade,
  size_mm    numeric,
  note       text,
  created_at timestamptz not null default now(),
  unique (lesion_id, study_id)
);
