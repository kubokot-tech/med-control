/**
 * Global search: Russian full-text search (stemming) over notes, milestones, document texts, imaging,
 * appointments, diary notes, infusions, AI answers, plus substring matches on lab markers, documents and medications.
 */
import { pool } from './db.js';
import { catalog } from './canonical.js';
import { milestoneTitle } from './eventText.js';
import { userFormat } from './userLocale.js';
import { relocalize, t } from './i18n.js';

const HL = `MaxWords=28, MinWords=12, MaxFragments=2, FragmentDelimiter=" … ", StartSel=**, StopSel=**`;
const like = (q) => `%${q.replace(/[%_]/g, '\\$&')}%`;

const STORED_DAY = /^(\d{2})\.(\d{2})\.(\d{4})$/; // to_char(…, 'DD.MM.YYYY') in the query below
const TITLE_KEYS = ['appointment', 'diary', 'shot', 'drip', 'aiAnswer', 'aiQuestion', 'labsAt', 'labs', 'medication'].map((k) => `searchTitles.${k}`);

/** A title built by the query (in Russian, the language of the index) in the user's language. */
function titleFor(x, f) {
  const language = f.language;
  if (x.kind === 'imaging' || x.kind === 'milestone') return milestoneTitle('imaging', x.title, language);
  if (x.kind === 'document') return x.title.replace(/^документ(?= · |$)/, () => t(language, 'searchTitles.document'));
  return relocalize(x.title, TITLE_KEYS, language, (a) => {
    const day = STORED_DAY.exec(a.date ?? '');
    return { ...a, ...(day ? { date: f.date(`${day[3]}-${day[2]}-${day[1]}`) } : {}), ...(a.doctor === 'врач' ? { doctor: t(language, 'searchTitles.doctor') } : {}) };
  });
}

/** Results [{ kind, id, title, snippet, date, rank, href }] for a query of at least two characters, best first. */
export async function searchAll(userId, q, { limit = 60 } = {}) {
  q = String(q || '').trim().slice(0, 200);
  limit = Math.min(Math.max(Number(limit) || 60, 1), 200);
  if (q.length < 2) return { q, results: [] };
  const P = [userId, q, like(q)];
  // each source: kind, id, title, snippet (ts_headline with **…** around matches), date, rank, link
  const sql = `
    with qq as (select websearch_to_tsquery('russian', $2) as tsq)
    select * from (
      select 'note' as kind, n.id::text as id, n.title, ts_headline('russian', coalesce(n.body, ''), qq.tsq, '${HL}') as snippet, n.updated_at as date,
             ts_rank(to_tsvector('russian', coalesce(n.title,'') || ' ' || coalesce(n.body,'')), qq.tsq) + (case when n.title ilike $3 then 0.5 else 0 end) as rank, '/notes/' || n.id as href
        from notes n, qq where n.user_id = $1 and (to_tsvector('russian', coalesce(n.title,'') || ' ' || coalesce(n.body,'')) @@ qq.tsq or n.title ilike $3)
      union all
      select 'milestone', m.id::text, m.title, ts_headline('russian', coalesce(m.notes, ''), qq.tsq, '${HL}'), m.date::timestamptz,
             ts_rank(to_tsvector('russian', coalesce(m.title,'') || ' ' || coalesce(m.notes,'')), qq.tsq) + (case when m.title ilike $3 then 0.5 else 0 end), '/history#' || m.id
        from milestones m, qq where m.user_id = $1 and m.kind <> 'ai_review' and (to_tsvector('russian', coalesce(m.title,'') || ' ' || coalesce(m.notes,'')) @@ qq.tsq or m.title ilike $3)
      union all
      select 'document', e.sha256, coalesce(a.filename, 'документ') || case when m.title is not null then ' · ' || m.title when n.title is not null then ' · ' || n.title else '' end,
             ts_headline('russian', coalesce(e.summary, '') || ' ' || coalesce(e.text, ''), qq.tsq, '${HL}'), coalesce(m.date::timestamptz, n.updated_at, e.created_at),
             ts_rank(to_tsvector('russian', coalesce(e.summary,'') || ' ' || coalesce(e.text,'')), qq.tsq),
             case when m.id is not null then '/history#' || m.id when n.id is not null then '/notes/' || n.id else '/history' end
        from attachment_extracts e
        left join attachments a on a.user_id = e.user_id and a.sha256 = e.sha256
        left join milestones m on m.event_id = a.event_id
        left join notes n on n.event_id = a.event_id, qq
       where e.user_id = $1 and to_tsvector('russian', coalesce(e.summary,'') || ' ' || coalesce(e.text,'')) @@ qq.tsq
      union all
      select 'imaging', s.id::text, s.modality || coalesce(' ' || s.body_region, ''), ts_headline('russian', coalesce(s.impression_text, ''), qq.tsq, '${HL}'), s.study_date::timestamptz,
             ts_rank(to_tsvector('russian', coalesce(s.modality,'') || ' ' || coalesce(s.body_region,'') || ' ' || coalesce(s.impression_text,'')), qq.tsq), '/imaging#' || s.id
        from imaging_studies s, qq where s.user_id = $1 and (to_tsvector('russian', coalesce(s.modality,'') || ' ' || coalesce(s.body_region,'') || ' ' || coalesce(s.impression_text,'')) @@ qq.tsq or s.modality ilike $3 or s.body_region ilike $3)
      union all
      select 'appointment', ap.id::text, 'Приём: ' || coalesce(ap.doctor, 'врач'), ts_headline('russian', coalesce(ap.notes, '') || ' ' || coalesce(ap.questions, ''), qq.tsq, '${HL}'), ap.date::timestamptz,
             ts_rank(to_tsvector('russian', coalesce(ap.doctor,'') || ' ' || coalesce(ap.place,'') || ' ' || coalesce(ap.notes,'') || ' ' || coalesce(ap.questions,'')), qq.tsq), '/consults'
        from appointments ap, qq where ap.user_id = $1 and (to_tsvector('russian', coalesce(ap.doctor,'') || ' ' || coalesce(ap.place,'') || ' ' || coalesce(ap.notes,'') || ' ' || coalesce(ap.questions,'')) @@ qq.tsq or ap.doctor ilike $3)
      union all
      select 'contact', ct.id::text, ct.name || coalesce(' · ' || ct.role, ''), coalesce(ct.clinic, '') || coalesce(' · ' || array_to_string(ct.phones, ', '), ''), ct.updated_at,
             1.0 + (case when ct.name ilike $3 then 0.5 else 0 end), '/contacts#' || ct.id
        from contacts ct where ct.user_id = $1 and (ct.name ilike $3 or ct.role ilike $3 or ct.clinic ilike $3 or ct.notes ilike $3 or ct.address ilike $3 or array_to_string(ct.phones, ' ') ilike $3)
      union all
      select 'symptom', se.date::text, 'Дневник ' || to_char(se.date, 'DD.MM.YYYY'), ts_headline('russian', coalesce(se.notes, ''), qq.tsq, '${HL}'), se.date::timestamptz,
             ts_rank(to_tsvector('russian', coalesce(se.notes,'')), qq.tsq), '/symptoms?date=' || se.date::text
        from symptom_entries se, qq where se.user_id = $1 and to_tsvector('russian', coalesce(se.notes,'')) @@ qq.tsq
      union all
      select 'infusion', i.id::text, (case when coalesce(i.route, ag.route) ~* 'в/м|п/к|струйн' then 'Укол: ' else 'Капельница: ' end) || coalesce(ag.short_name, ag.name), ts_headline('russian', coalesce(i.notes, '') || ' ' || coalesce(i.reaction, ''), qq.tsq, '${HL}'), i.date::timestamptz,
             ts_rank(to_tsvector('russian', coalesce(i.notes,'') || ' ' || coalesce(i.reaction,'') || ' ' || coalesce(i.place,'')), qq.tsq), '/infusions'
        from infusion_sessions i join infusion_agents ag on ag.id = i.agent_id, qq where i.user_id = $1 and (to_tsvector('russian', coalesce(i.notes,'') || ' ' || coalesce(i.reaction,'') || ' ' || coalesce(i.place,'')) @@ qq.tsq or ag.name ilike $3)
      union all
      select 'ai', c.id::text, 'Ответ ИИ · ' || c.subject_type, ts_headline('russian', c.text, qq.tsq, '${HL}'), c.created_at,
             ts_rank(to_tsvector('russian', c.text), qq.tsq) * 0.6,
             case c.subject_type when 'lab_document' then '/labs/documents/' || c.subject_id when 'imaging_study' then '/imaging#' || c.subject_id when 'note' then '/notes/' || c.subject_id when 'labs_month' then '/labs/summary' when 'infusions' then '/infusions' else '/' end
        from ai_comments c, qq where c.user_id = $1 and to_tsvector('russian', c.text) @@ qq.tsq
      union all
      select 'ai', x.id::text, 'Вопрос ИИ: ' || left(x.question, 80), ts_headline('russian', x.answer, qq.tsq, '${HL}'), x.created_at,
             ts_rank(to_tsvector('russian', x.question || ' ' || x.answer), qq.tsq) * 0.6,
             case x.subject_type when 'lab_document' then '/labs/documents/' || x.subject_id when 'imaging_study' then '/imaging#' || x.subject_id when 'note' then '/notes/' || x.subject_id when 'labs_month' then '/labs/summary' when 'infusions' then '/infusions' else '/' end
        from ai_questions x, qq where x.user_id = $1 and to_tsvector('russian', x.question || ' ' || x.answer) @@ qq.tsq
      union all
      select 'labdoc', d.id::text, 'Анализы ' || coalesce(to_char(d.doc_date, 'DD.MM.YYYY'), '') || coalesce(' · ' || d.lab_name, ''), coalesce(d.filename, ''), d.doc_date::timestamptz, 0.3, '/labs/documents/' || d.id
        from ingest_documents d where d.user_id = $1 and (d.lab_name ilike $3 or d.filename ilike $3)
      union all
      select 'medication', md.id::text, 'Препарат: ' || md.name, coalesce(md.instructions, ''), md.created_at, 0.8, '/meds'
        from medications md where md.user_id = $1 and (md.name ilike $3 or md.instructions ilike $3)
    ) r order by rank desc, date desc nulls last limit $4`;
  const r = await pool.query(sql, [...P, limit]);
  // lab markers from the catalog (names and short names), e.g. «АЛТ», «креатинин»
  const ql = q.toLowerCase();
  const f = await userFormat(userId);
  const hit = (c) => c.name.toLowerCase().includes(ql) || (c.short || '').toLowerCase().includes(ql);
  // a marker is found by its name in the interface language or in Russian, the language of lab reports
  const ru = new Map(catalog().map((c) => [c.key, c]));
  const markers = catalog(f.language).filter((c) => hit(c) || hit(ru.get(c.key)) || c.key.toLowerCase() === ql)
    .slice(0, 6).map((c) => ({ kind: 'marker', id: c.key, title: t(f.language, 'searchTitles.marker', { name: c.name }), snippet: t(f.language, c.category === 'urine' ? 'searchTitles.urine' : 'searchTitles.blood'), date: null, rank: 1, href: `/labs/series?key=${encodeURIComponent(c.key)}` }));
  return { q, results: [...markers, ...r.rows.map((x) => ({ ...x, title: titleFor(x, f), rank: Number(x.rank) }))] };
}
