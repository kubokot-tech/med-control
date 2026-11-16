-- 030_dosing_schedule.sql
-- Not every drug is taken daily: weekly on given weekdays (methotrexate) or every N days from the regimen start.
-- frequency_rule: 'DAILY' (as before) | 'WEEKLY' (schedule_days, ISO weekdays 1 = Monday … 7 = Sunday) | 'EVERY_N_DAYS' (interval_days).
alter table regimen_items
  add column if not exists schedule_days smallint[],
  add column if not exists interval_days smallint;
