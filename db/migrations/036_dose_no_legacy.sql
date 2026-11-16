-- Before 035 a day had one mark even for «2 раза в день», and a TAKEN mark meant the whole day. 035 made such marks
-- dose 1, so every past day of a twice-daily drug turned «приняты не все дозы» (the streak at zero, 0% in the doctor
-- report). Fill in the other doses of those days with the same status. Only marks older than 035 itself: marks made
-- per dose since then are left as they are.
insert into administrations (user_id, medication_id, regimen_item_id, taken_at, day, dose_no, status, dose_value, dose_unit, notes)
select a.user_id, a.medication_id, a.regimen_item_id, a.taken_at, a.day, n, a.status, a.dose_value, a.dose_unit, 'до отметок по приёмам'
  from administrations a
  join regimen_items ri on ri.id = a.regimen_item_id
  cross join lateral generate_series(2, least(greatest(ri.times_per_day, 1), 12)) as n
 where a.dose_no = 1
   and a.created_at < coalesce((select applied_at from schema_migrations where filename = '035_dose_no.sql'), now())
   and not exists (select 1 from administrations b
                    where b.user_id = a.user_id and b.medication_id = a.medication_id and b.day = a.day and b.dose_no > 1)
on conflict do nothing;
