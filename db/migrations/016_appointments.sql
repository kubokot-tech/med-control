-- 016_appointments.sql
-- Doctor appointments: reminders before, AI questions from the data accumulated since the last visit,
-- the doctor's report attached afterwards (as a consult milestone) which closes the reminders.
create table if not exists appointments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  date                 date not null,
  time                 text,                       -- 'HH:MM', optional
  doctor               text,
  place                text,
  notes                text,
  status               text not null default 'planned',   -- planned | done | cancelled
  questions            text,
  questions_context    text,
  questions_model      text,
  questions_at         timestamptz,
  report_milestone_id  uuid references milestones(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists appointments_user_date_idx on appointments(user_id, date);
