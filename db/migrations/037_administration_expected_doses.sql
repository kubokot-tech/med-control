-- A journal entry keeps the daily frequency in effect when it was recorded.
alter table administrations add column expected_doses int check (expected_doses between 1 and 12);
update administrations a set expected_doses = greatest(a.dose_no,
  coalesce((select (e.meta->>'times')::int from events e
            where e.id = a.event_id and e.meta->>'times' ~ '^([1-9]|1[0-2])$'),
           (select ri.times_per_day from regimen_items ri where ri.id = a.regimen_item_id), 1));

create function fill_administration_expected_doses() returns trigger language plpgsql as $$
begin
  if new.expected_doses is null then
    new.expected_doses := greatest(new.dose_no,
      coalesce((select times_per_day from regimen_items where id = new.regimen_item_id), 1));
  end if;
  return new;
end;
$$;
create trigger administration_expected_doses before insert on administrations
  for each row execute function fill_administration_expected_doses();
alter table administrations alter column expected_doses set not null;
