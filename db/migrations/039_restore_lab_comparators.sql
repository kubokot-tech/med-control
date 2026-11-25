-- Older unit normalization could strip the comparator from a converted number.
-- Recover it only for a one-to-one match with the original document observation.
with raw_observation as (
  select document_id, trim(test_name_raw) as code, min(unit_raw) as unit,
         min(substring(trim(result_text) from '^([<>]=?|[≤≥])')) as comparator
  from ingest_observations_raw
  group by document_id, trim(test_name_raw)
  having count(*) = 1
), stored as (
  select document_id, test_id from lab_results
  where document_id is not null
  group by document_id, test_id having count(*) = 1
)
update lab_results r
set value_text = o.comparator || replace(trim_scale(r.value_numeric)::text, '.', ',')
from stored s
join lab_tests t on t.id = s.test_id
join raw_observation o on o.document_id = s.document_id and o.code = t.code
where r.document_id = s.document_id and r.test_id = s.test_id
  and o.comparator is not null and r.value_numeric is not null
  and o.unit = r.unit_original and r.unit_original is distinct from r.unit_canonical
  and trim(r.value_text) ~ '^[+-]?[0-9]+([.,][0-9]+)?$';

-- Earlier conversion also left the printed number in its original unit when
-- a comparator such as <= or ≥ survived. The stored bound itself is sufficient.
update lab_results
set value_text = substring(trim(value_text) from '^([<>]=?|[≤≥])') ||
                 replace(trim_scale(value_numeric)::text, '.', ',')
where unit_original is distinct from unit_canonical and value_numeric is not null
  and trim(value_text) ~ '^([<>]=?|[≤≥])[[:space:]]*[+-]?[0-9]+([.,][0-9]+)?$'
  and replace(substring(trim(value_text) from '([+-]?[0-9]+[.,]?[0-9]*)$'), ',', '.')::numeric <> value_numeric;
