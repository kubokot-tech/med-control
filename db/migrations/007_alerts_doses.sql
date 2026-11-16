-- 007_alerts_doses.sql
-- Alerts dedup index (rules live in gateway/src/lib/alerts.js) and dose change history.

create index if not exists idx_alerts_user_status on alerts(user_id, status, triggered_at desc);
create index if not exists idx_alerts_dedup on alerts(user_id, (context->>'dedup'));

create table if not exists dose_changes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  regimen_item_id uuid not null references regimen_items(id) on delete cascade,
  effective_from  date not null,
  dose_value      numeric not null,
  dose_unit       text not null,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_dose_changes_item on dose_changes(regimen_item_id, effective_from desc);

-- Seed the current dose of every regimen item as its first history row.
insert into dose_changes (user_id, regimen_item_id, effective_from, dose_value, dose_unit, reason)
select r.user_id, ri.id, r.start_date, ri.dose_value, coalesce(ri.dose_unit, 'mg'), 'начальная доза'
from regimen_items ri
join regimens r on r.id = ri.regimen_id
where ri.dose_value is not null
  and not exists (select 1 from dose_changes d where d.regimen_item_id = ri.id);
