-- 033_contacts.sql
-- Doctors and other contacts of the treatment: who, where, how to reach them (Ещё → «Врачи и контакты»).
create table if not exists contacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null,
  role       text,                      -- specialty or role: «онколог», «регистратура», «медсестра»
  clinic     text,
  phones     text[] not null default '{}',
  email      text,
  address    text,
  url        text,                      -- site or patient portal, http(s) only
  notes      text,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_user_idx on contacts(user_id, pinned desc, name);
