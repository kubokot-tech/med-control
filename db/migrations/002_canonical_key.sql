-- 002_canonical_key.sql
-- Add canonical_key to lab_tests to allow merging same biomarker across labs.

alter table lab_tests
  add column if not exists canonical_key text;

create index if not exists lab_tests_canonical_key_idx on lab_tests(canonical_key);

-- Backfill a minimal canonical mapping by name.
update lab_tests set canonical_key='ALT'
 where canonical_key is null and code ~* '(\bАЛТ\b|аланинаминотрансфераз|\bALT\b)';
update lab_tests set canonical_key='AST'
 where canonical_key is null and code ~* '(\bАСТ\b|аспартатаминотрансфераз|\bAST\b)';
update lab_tests set canonical_key='CREA'
 where canonical_key is null and code ~* '(креатинин|\bCREA\b|\bCREAT\b)';
update lab_tests set canonical_key='HGB'
 where canonical_key is null and code ~* '(гемоглобин|\bHGB\b|\bHb\b)';
update lab_tests set canonical_key='WBC'
 where canonical_key is null and code ~* '(лейкоцит|\bWBC\b)';
update lab_tests set canonical_key='PLT'
 where canonical_key is null and code ~* '(тромбоцит|\bPLT\b)';
update lab_tests set canonical_key='NEUT#'
 where canonical_key is null and code ~* '(абсолютн(ое|ого) количеств(о|а) нейтрофил|\bNEUT#\b|нейтрофил.*абс)';
update lab_tests set canonical_key='NEUT%'
 where canonical_key is null and code ~* '(относительн(ое|ого) количеств(о|а) нейтрофил|нейтрофилы,? %|\bNEUT%\b)';
update lab_tests set canonical_key='TSH'
 where canonical_key is null and code ~* '(\bТТГ\b|тиреотропн|\bTSH\b)';
update lab_tests set canonical_key='HbA1c'
 where canonical_key is null and code ~* '(HbA1c|гликированн)';
update lab_tests set canonical_key='eAG'
 where canonical_key is null and code ~* '(\beAG\b|среднесуточн.*глюкоз)';
