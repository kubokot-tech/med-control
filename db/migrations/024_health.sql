-- 024_health.sql
-- Apple Health: raw samples received from the phone (Health Auto Export / Shortcuts / XML import) and
-- two more diary fields (pulse, steps) that they fill.
alter table symptom_entries add column if not exists pulse integer, add column if not exists steps integer;
create table if not exists health_samples (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  kind        text not null,            -- blood_pressure | weight_body_mass | body_temperature | heart_rate | resting_heart_rate | step_count | ...
  ts          timestamptz not null,
  value       jsonb not null,
  source      text not null default 'health_auto_export',
  created_at  timestamptz not null default now(),
  unique (user_id, kind, ts)
);
create index if not exists health_samples_user_kind_ts_idx on health_samples(user_id, kind, ts desc);
