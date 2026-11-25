-- Old XML imports kept Fahrenheit units in health_samples but copied the
-- number into the Celsius diary. Match that exact daily maximum before repair.
with readings as (
  select h.id, h.user_id, (h.ts at time zone u.timezone)::date as day,
         (h.value->>'qty')::numeric as qty, lower(trim(h.value->>'units')) as unit
  from health_samples h join users u on u.id = h.user_id
  where h.kind = 'body_temperature' and jsonb_typeof(h.value->'qty') = 'number'
), temperatures as (
  select *, unit in ('°f', 'degf', 'f', 'fahrenheit') as fahrenheit,
         case when unit in ('°f', 'degf', 'f', 'fahrenheit') then round((qty - 32) * 5 / 9, 1)
              when unit in ('°c', 'degc', 'c', 'celsius') then qty end as celsius
  from readings
), maxima as (
  select user_id, day, round(max(qty), 1) as old_max, round(max(celsius), 1) as corrected
  from temperatures group by user_id, day
  having max(qty) = max(qty) filter (where fahrenheit) and bool_and(celsius is not null)
), converted as (
  update health_samples h set value = h.value || jsonb_build_object('qty', t.celsius, 'units', 'degC')
  from temperatures t where h.id = t.id and t.fahrenheit
)
update symptom_entries s set temp_c = m.corrected
from maxima m where s.user_id = m.user_id and s.date = m.day and s.temp_c = m.old_max;
