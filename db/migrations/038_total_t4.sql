-- The 0.4.2 classifier also matched bare or total T4. iPad skips the full
-- startup recanonicalization, so repair unambiguous stored misclassifications here.
-- Preserve raw results, original names, units and explicitly free T4.
update lab_tests
set canonical_key = null
where canonical_key = 'FT4'
  and code ~* '(^|[^а-яa-z0-9])т4([^а-яa-z0-9]|$)'
  and (btrim(code) ~* '^т4$' or code ~* 'общ(ий|его)|total')
  and code !~* 'свободн|free|ft4';
