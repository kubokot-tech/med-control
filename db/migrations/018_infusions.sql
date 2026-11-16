-- 018_infusions.sql
-- Infusions: an editable catalog of agents with default doses, and a log of sessions.
create table if not exists infusion_agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  short_name    text,
  default_dose  numeric,
  dose_unit     text,
  route         text not null default 'в/в капельно',
  notes         text,                       -- what it is for, in the patient's words
  active        boolean not null default true,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  unique (user_id, name)
);
-- (the empty MVP table `infusions` from 001 stays untouched; sessions live in infusion_sessions)
create table if not exists infusion_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  agent_id      uuid not null references infusion_agents(id) on delete restrict,
  event_id      uuid references events(id) on delete set null,
  date          date not null,
  time          text,
  dose_value    numeric,
  dose_unit     text,
  duration_min  int,
  place         text,
  notes         text,
  reaction      text,                       -- how it felt during/after
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists infusion_sessions_user_date_idx on infusion_sessions(user_id, date desc);
