-- 032_reference_ranges.sql
-- Reference ranges (docs/REFERENCE-RANGES.md). A result keeps the range printed by its laboratory (lab_results.ref_low/high);
-- what the app compares against is resolved by the view lab_results_eff, in this order:
--   1. the user's own range for the marker (lab_ref_overrides, mode 'custom'), or «as printed by the lab» (mode 'lab');
--   2. the built-in range of the catalog for the patient's sex (users.sex), then the one for any sex;
--   3. the range printed by the laboratory.
-- Built-in and own ranges are in the catalog unit, so they apply only to results converted to it (lib/units.js);
-- dimensionless markers (specific gravity, pH) have an empty unit on both sides.
-- An open side is null: «< 5» is (null, 5).

-- Catalog ranges: ref_low_default/ref_high_default (any sex, 005) plus by sex; upserted from lib/catalogSeed.js at start.
alter table lab_catalog
  add column if not exists ref_low_m  numeric,
  add column if not exists ref_high_m numeric,
  add column if not exists ref_low_f  numeric,
  add column if not exists ref_high_f numeric;

-- Sex used only to pick reference ranges; null = not given (sex-specific ranges then come from the lab).
alter table users add column if not exists sex text;
do $$ begin
  alter table users add constraint users_sex_check check (sex in ('m', 'f'));
exception when duplicate_object then null; end $$;

create table if not exists lab_ref_overrides (
  user_id    uuid not null references users(id) on delete cascade,
  key        text not null,
  mode       text not null default 'custom' check (mode in ('custom', 'lab')),
  ref_low    numeric,
  ref_high   numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  check (mode = 'lab' or ref_low is not null or ref_high is not null),
  check (ref_low is null or ref_high is null or ref_low <= ref_high)
);

-- Results with the range in force (ref_low, ref_high, ref_source: 'user' | 'catalog' | 'lab' | null) and the lab's own
-- (lab_ref_low, lab_ref_high). Reads go through this view; writes go to lab_results.
create or replace view lab_results_eff as
select r.id, r.user_id, r.test_id, r.collected_at, r.value_numeric, r.value_text, r.unit_original, r.unit_canonical,
       e.ref_low, e.ref_high, e.ref_source,
       r.ref_low as lab_ref_low, r.ref_high as lab_ref_high,
       r.lab_name, r.source_event_id, r.created_at, r.document_id
from lab_results r
left join lab_tests t on t.id = r.test_id
left join lab_catalog c on c.key = t.canonical_key and coalesce(c.unit_canonical, '') = coalesce(r.unit_canonical, '')
left join users u on u.id = r.user_id
left join lab_ref_overrides o on o.user_id = r.user_id and o.key = t.canonical_key
cross join lateral (
  select x.lo as ref_low, x.hi as ref_high, x.src as ref_source
  from (values
    (1, o.mode = 'custom' and c.key is not null, o.ref_low, o.ref_high, 'user'),
    (2, o.mode = 'lab', r.ref_low, r.ref_high, case when r.ref_low is null and r.ref_high is null then null else 'lab' end),
    (3, c.key is not null and u.sex = 'm' and (c.ref_low_m is not null or c.ref_high_m is not null), c.ref_low_m, c.ref_high_m, 'catalog'),
    (4, c.key is not null and u.sex = 'f' and (c.ref_low_f is not null or c.ref_high_f is not null), c.ref_low_f, c.ref_high_f, 'catalog'),
    (5, c.key is not null and (c.ref_low_default is not null or c.ref_high_default is not null), c.ref_low_default, c.ref_high_default, 'catalog'),
    (6, true, r.ref_low, r.ref_high, case when r.ref_low is null and r.ref_high is null then null else 'lab' end)
  ) x(ord, ok, lo, hi, src)
  where x.ok
  order by x.ord
  limit 1
) e;
