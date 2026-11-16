-- Several doses a day («2 раза в день»): each dose is its own mark, numbered within the day.
-- Before: one mark per medication per day; existing marks become dose 1.
alter table administrations add column if not exists dose_no smallint not null default 1;
alter table administrations drop constraint if exists administrations_dose_no_check;
alter table administrations add constraint administrations_dose_no_check check (dose_no between 1 and 12);
drop index if exists administrations_user_med_day_idx;
create unique index if not exists administrations_user_med_day_dose_idx on administrations(user_id, medication_id, day, dose_no);
