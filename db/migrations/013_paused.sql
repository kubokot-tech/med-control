-- 013_paused.sql
-- Therapy pause (e.g. hepatotoxicity): a day that is neither taken nor missed.
alter type admin_status add value if not exists 'PAUSED';
