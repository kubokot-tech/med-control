-- 019_constraints_meta.sql
-- Structured event metadata instead of positional tags; one dose row per day enforced by the DB;
-- direct link result → document; check constraints on free-text enums; indexes on hot foreign keys.

-- events.meta: {status} for MED_ADMIN, {kind, tone} for MILESTONE, {agent} for INFUSION (tags kept for old readers)
alter table events add column if not exists meta jsonb not null default '{}'::jsonb;
update events set meta = jsonb_build_object('status', upper(tags->>1)) where type = 'MED_ADMIN' and meta = '{}'::jsonb and jsonb_typeof(tags) = 'array' and tags->>1 is not null;
update events set meta = jsonb_build_object('kind', coalesce(tags->>1, 'other'), 'tone', coalesce(tags->>2, 'neutral')) where type = 'MILESTONE' and meta = '{}'::jsonb and jsonb_typeof(tags) = 'array';
update events set meta = jsonb_build_object('agent', tags->>1) where type = 'INFUSION' and meta = '{}'::jsonb and jsonb_typeof(tags) = 'array' and tags->>1 is not null;
create index if not exists events_user_type_idx on events(user_id, type, occurred_at desc);

-- administrations.day: the calendar day in the user's zone, unique per medication
alter table administrations add column if not exists day date;
update administrations set day = (coalesce(taken_at, scheduled_for, created_at) at time zone 'Europe/Moscow')::date where day is null;
-- duplicates (web + Telegram on the same day): keep the earliest row
delete from administrations a using administrations b
  where a.user_id = b.user_id and a.medication_id = b.medication_id and a.day = b.day and a.created_at > b.created_at;
alter table administrations alter column day set not null;
create unique index if not exists administrations_user_med_day_idx on administrations(user_id, medication_id, day);

-- administrations.event_id: the feed row of a dose, instead of matching by timestamp
alter table administrations add column if not exists event_id uuid references events(id) on delete set null;
update administrations a set event_id = e.id from events e
  where a.event_id is null and e.user_id = a.user_id and e.type = 'MED_ADMIN' and e.occurred_at = coalesce(a.taken_at, a.created_at);

-- attachments: the same file on the same event only once
delete from attachments a using attachments b
  where a.event_id = b.event_id and a.sha256 = b.sha256 and a.id > b.id;
create unique index if not exists attachments_event_sha_idx on attachments(event_id, sha256);
create index if not exists attachments_sha_idx on attachments(sha256);

-- lab results ↔ document without the sha256 detour
alter table ingest_documents add column if not exists event_id uuid references events(id) on delete set null;
update ingest_documents d set event_id = a.event_id from attachments a
  where d.event_id is null and a.user_id = d.user_id and a.sha256 = d.sha256 and a.event_id is not null;
alter table lab_results add column if not exists document_id uuid references ingest_documents(id) on delete set null;
update lab_results r set document_id = d.id from ingest_documents d
  where r.document_id is null and d.event_id = r.source_event_id;
create index if not exists lab_results_document_idx on lab_results(document_id);
create index if not exists lab_results_event_idx on lab_results(source_event_id);
create index if not exists lab_results_test_idx on lab_results(test_id);

-- free-text enums
alter table milestones drop constraint if exists milestones_kind_chk;
alter table milestones add constraint milestones_kind_chk check (kind in ('surgery','radiation','histology','imaging','consult','document','other','ai_review'));
alter table milestones drop constraint if exists milestones_tone_chk;
alter table milestones add constraint milestones_tone_chk check (tone in ('positive','negative','neutral'));
alter table imaging_studies drop constraint if exists imaging_response_chk;
alter table imaging_studies add constraint imaging_response_chk check (response is null or response in ('CR','PR','SD','PD','NA'));
alter table appointments drop constraint if exists appointments_status_chk;
alter table appointments add constraint appointments_status_chk check (status in ('planned','done','cancelled'));
