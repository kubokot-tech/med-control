-- 026_med_roles.sql
-- Systemic therapy vs supporting medications, per-item reminder time and intake instructions.
alter table medications
  add column if not exists role text not null default 'support' check (role in ('systemic', 'support')),
  add column if not exists instructions text,
  add column if not exists sort_order int not null default 100;
alter table regimen_items
  add column if not exists remind_at text,
  add column if not exists times_per_day int not null default 1;
-- everything that was active before this migration is the systemic drug (single-drug therapy so far)
update medications m set role = 'systemic', sort_order = 10
 where exists (select 1 from regimen_items ri join regimens r on r.id = ri.regimen_id
                where ri.medication_id = m.id and ri.frequency_rule = 'DAILY' and (r.end_date is null or r.end_date > now()));
