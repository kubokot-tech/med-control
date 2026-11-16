-- 031_user_locale.sql
-- Language and regional formats of the user (docs/I18N.md). Data stays canonical; these only change how it is shown.
-- prefs: { region: 'RU', dateFormat: 'auto'|'dmy'|'mdy'|'ymd', hourCycle: 'auto'|'h23'|'h12', weekStart: 'auto'|'mon'|'sun' }
alter table users
  add column if not exists locale text not null default 'ru',
  add column if not exists prefs jsonb not null default '{}'::jsonb;
