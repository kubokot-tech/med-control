-- 020_courses_versions.sql
-- Infusion courses (planned count, cadence, reminders) and anamnesis version history.
create table if not exists infusion_courses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  agent_id       uuid not null references infusion_agents(id) on delete restrict,
  title          text,
  planned_count  int,
  cadence_days   int,
  start_date     date not null,
  status         text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  remind         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists infusion_courses_user_idx on infusion_courses(user_id, status);
alter table infusion_sessions add column if not exists course_id uuid references infusion_courses(id) on delete set null;
create index if not exists infusion_sessions_course_idx on infusion_sessions(course_id);

create table if not exists anamnesis_versions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  text        text not null,
  source      text not null default 'manual',   -- initial | manual | ai_draft | restore
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists anamnesis_versions_user_idx on anamnesis_versions(user_id, created_at desc);
-- the text already in settings becomes the first version
insert into anamnesis_versions (user_id, text, source)
select u.id, s.value, 'initial' from app_settings s cross join users u
 where s.key = 'anamnesis' and coalesce(s.value, '') <> '' and not exists (select 1 from anamnesis_versions);
