-- 008_milestones.sql
-- Disease milestones (surgery, radiation, histology, control imaging…) with attachments.

alter type event_type add value if not exists 'MILESTONE';

alter table attachments add column if not exists filename text;

create table if not exists milestones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  event_id   uuid references events(id) on delete set null,
  date       date not null,
  kind       text not null,              -- surgery | radiation | histology | imaging | consult | other
  tone       text not null default 'neutral', -- positive | negative | neutral
  title      text not null,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_milestones_user_date on milestones(user_id, date desc);
