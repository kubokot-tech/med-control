-- 003_ingest_tables.sql
-- Creates ingest_documents and ingest_observations_raw (missing from 001_init).
-- Also fixes canonical_key inconsistency: NEUT_ABS/NEUT_PCT → NEUT#/NEUT%

-- ingest_documents: one row per uploaded PDF
create table if not exists ingest_documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  source     text not null,
  sha256     text not null,
  filename   text,
  lab_name   text,
  doc_date   date,
  created_at timestamptz not null default now(),
  unique(user_id, sha256)
);
create index if not exists idx_ingest_documents_user on ingest_documents(user_id, created_at desc);

-- ingest_observations_raw: raw parsed rows from the PDF, before canonicalization
create table if not exists ingest_observations_raw (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references ingest_documents(id) on delete cascade,
  test_name_raw text not null,
  result_text   text,
  result_num    numeric,
  unit_raw      text,
  ref_text_raw  text,
  ref_low       numeric,
  ref_high      numeric
);
create index if not exists idx_ingest_obs_raw_doc on ingest_observations_raw(document_id);

-- Fix canonical_key inconsistency introduced by server.js using NEUT_ABS/NEUT_PCT
-- while migration 002 used NEUT#/NEUT%. Standardise on NEUT#/NEUT%.
update lab_tests set canonical_key = 'NEUT#'
 where canonical_key = 'NEUT_ABS';
update lab_tests set canonical_key = 'NEUT%'
 where canonical_key = 'NEUT_PCT';
