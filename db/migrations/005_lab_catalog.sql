-- 005_lab_catalog.sql
-- Reference catalog of lab markers. Rows are upserted from gateway/src/lib/catalogSeed.js at
-- gateway start; the table exists so the frontend and SQL can read the same source of truth.
create table if not exists lab_catalog (
  key              text primary key,
  name_ru          text not null,
  short_ru         text,
  category         text not null default 'blood',
  unit_canonical   text,
  aliases          text[] not null default '{}',
  pattern          text,
  sort_order       int  not null default 100,
  is_key           boolean not null default false,
  ref_low_default  numeric,
  ref_high_default numeric,
  updated_at       timestamptz not null default now()
);
