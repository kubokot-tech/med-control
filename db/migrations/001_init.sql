-- MedControl (DTC) MVP schema (PostgreSQL)
-- Uses uuid primary keys, requires pgcrypto.

create extension if not exists pgcrypto;

-- 1) users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  password_hash text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

-- enums
do $$ begin
  create type event_type as enum ('MED_ADMIN','INFUSION','LAB_RESULT','IMAGING','CONSULT','SYMPTOM','VITAL','NOTE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admin_status as enum ('PLANNED','TAKEN','MISSED','SKIPPED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_scope as enum ('LAB','SYMPTOM','VITAL','MED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_severity as enum ('YELLOW','RED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_status as enum ('OPEN','ACK','RESOLVED');
exception when duplicate_object then null; end $$;

-- 2) events (unified timeline)
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type event_type not null,
  occurred_at timestamptz not null,
  title text,
  notes text,
  tags jsonb not null default '[]'::jsonb,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists idx_events_user_occurred on events(user_id, occurred_at desc);

-- 3) attachments
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  file_url text not null,
  mime_type text,
  sha256 text,
  created_at timestamptz not null default now()
);
create index if not exists idx_attachments_user_event on attachments(user_id, event_id);

-- 4) medications
create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  form text,
  strength text,
  unit text,
  atc_code text,
  created_at timestamptz not null default now()
);
create index if not exists idx_medications_user on medications(user_id);

-- 5) regimens
create table if not exists regimens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);

-- 6) regimen_items
create table if not exists regimen_items (
  id uuid primary key default gen_random_uuid(),
  regimen_id uuid not null references regimens(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete restrict,
  dose_value numeric,
  dose_unit text,
  route text,
  frequency_rule text,
  time_windows jsonb,
  days_of_week jsonb,
  prn boolean not null default false
);

-- 7) administrations
create table if not exists administrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete restrict,
  regimen_item_id uuid references regimen_items(id) on delete set null,
  scheduled_for timestamptz,
  taken_at timestamptz,
  status admin_status not null default 'PLANNED',
  dose_value numeric,
  dose_unit text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_user_sched on administrations(user_id, scheduled_for desc);
create index if not exists idx_admin_user_taken on administrations(user_id, taken_at desc);

-- 8) infusions
create table if not exists infusions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  components jsonb,
  planned_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  volume_ml integer,
  diluent text,
  notes text,
  created_at timestamptz not null default now()
);

-- 9) lab_tests (global catalog)
create table if not exists lab_tests (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  category text,
  canonical_unit text
);

-- 10) lab_results
create table if not exists lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  test_id uuid not null references lab_tests(id) on delete restrict,
  collected_at timestamptz not null,
  value_numeric numeric,
  value_text text,
  unit_original text,
  unit_canonical text,
  ref_low numeric,
  ref_high numeric,
  lab_name text,
  source_event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_lab_results_user_time on lab_results(user_id, collected_at desc);

-- 11) imaging_studies
create table if not exists imaging_studies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  modality text,
  body_region text,
  performed_at timestamptz not null,
  impression_text text,
  structured_findings jsonb,
  source_event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 12) symptom_entries
create table if not exists symptom_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  throat_pain integer,
  jaw_ear_pain integer,
  reflux integer,
  nausea integer,
  fatigue integer,
  sleep_quality integer,
  anxiety integer,
  temp_c numeric,
  bp_sys integer,
  bp_dia integer,
  weight_kg numeric,
  notes text,
  created_at timestamptz not null default now(),
  unique(user_id, date)
);

-- 13) alert_rules
create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  scope alert_scope not null,
  key text not null,
  condition jsonb not null,
  severity alert_severity not null,
  message_template text,
  created_at timestamptz not null default now()
);

-- 14) alerts
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  rule_id uuid references alert_rules(id) on delete set null,
  triggered_at timestamptz not null,
  status alert_status not null default 'OPEN',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Audit placeholder (optional MVP extension)
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
