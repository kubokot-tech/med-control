import { pool } from '../lib/db.js';
import { eventMeta } from '../lib/feed.js';
import { feedText } from '../lib/eventText.js';
import { summarize, rowToEntry } from '../lib/symptoms.js';
import { userFormat } from '../lib/userLocale.js';
import { bodyUnits } from '../../../shared/units.js';
import { DEFAULT_LANGUAGE } from '../../../shared/format.js';
import { t } from '../lib/i18n.js';
import { DEFAULT_TZ } from '../lib/dates.js';
import { UUID_RX, outOfRangeSql } from '../lib/labsQuery.js';

function encodeCursor(occurredAt, id) {
  return Buffer.from(`${new Date(occurredAt).toISOString()}|${id}`, 'utf8').toString('base64url');
}
function decodeCursor(s) {
  if (!s) return null;
  try {
    const [ts, id] = Buffer.from(String(s), 'base64url').toString('utf8').split('|');
    if (!ts || !UUID_RX.test(id) || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

/**
 * The summary of a SYMPTOM event, the interface adds its own prefix. In Russian it is the stored title without the
 * prefix; in another language it is written again from the day's entry, in the user's units.
 */
async function symptomSummaries(userId, rows, format) {
  const language = format.language;
  const prefix = t(DEFAULT_LANGUAGE, 'feedTitles.symptom', { summary: '' });
  const stored = (row) => (row.title?.startsWith(prefix) ? { summary: row.title.slice(prefix.length) } : null);
  const days = rows.filter((x) => x.type === 'SYMPTOM').map((x) => x.day);
  if (language === DEFAULT_LANGUAGE || !days.length) return (row) => (row.type === 'SYMPTOM' ? stored(row) : null);
  const entries = await pool.query('select *, date::text as day from symptom_entries where user_id = $1 and date = any($2::date[])', [userId, days]);
  const byDay = new Map(entries.rows.map((x) => [x.day, rowToEntry(x)]));
  const body = bodyUnits({ temperature: format.temperature, weight: format.weight, language });
  const number = (v) => format.number(v);
  return (row) => {
    if (row.type !== 'SYMPTOM') return null;
    const entry = byDay.get(row.day);
    return entry ? { summary: summarize(entry, language, { body, number }) } : stored(row);
  };
}

export default async function timelineRoutes(app) {
  // Unified event feed, newest first, keyset-paginated by (occurred_at, id).
  app.get('/timeline', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const tz = req.user.tz || DEFAULT_TZ;
    const limit = Math.min(Math.max(parseInt(req.query?.limit || '30', 10) || 30, 1), 100);
    const cursor = decodeCursor(req.query?.cursor);
    if (req.query?.cursor && !cursor) return reply.code(400).send({ error: 'bad_cursor' });

    const r = await pool.query(
      `select e.id, e.type, e.occurred_at, e.title, e.notes, e.tags, e.meta, e.source, (select n.id from notes n where n.event_id = e.id limit 1) as note_id,
              coalesce(d.doc_date::text, to_char(e.occurred_at at time zone $2, 'YYYY-MM-DD')) as day,
              d.id as document_id, d.lab_name, lr.total, lr.flagged
       from events e
       left join lateral (
         select d.id, d.lab_name, d.doc_date from ingest_documents d where d.event_id = e.id
         union all
         select d.id, d.lab_name, d.doc_date from attachments a join ingest_documents d on d.user_id = a.user_id and d.sha256 = a.sha256 where a.event_id = e.id and d.event_id is null
         limit 1
       ) d on e.type = 'LAB_RESULT'
       left join lateral (
         select count(*)::int as total,
                count(*) filter (where ${outOfRangeSql})::int as flagged
         from lab_results_eff r
         where r.source_event_id = e.id
       ) lr on e.type = 'LAB_RESULT'
       where e.user_id = $1
         and ($3::timestamptz is null or (e.occurred_at, e.id) < ($3::timestamptz, $4::uuid))
       order by e.occurred_at desc, e.id desc
       limit $5`,
      [userId, tz, cursor?.ts ?? null, cursor?.id ?? null, limit + 1]
    );

    const rows = r.rows.slice(0, limit);
    const format = await userFormat(userId);
    const symptomSummary = await symptomSummaries(userId, rows, format);
    const items = rows.map((row) => {
      const tags = Array.isArray(row.tags) ? row.tags : [];
      const text = feedText({ type: row.type, title: row.title, notes: row.notes, source: row.source, kind: row.type === 'MILESTONE' ? eventMeta(row).kind : null }, format.language);
      return {
        id: row.id,
        type: row.type,
        occurredAt: row.occurred_at,
        day: row.day,
        title: text.title,
        notes: text.notes,
        source: row.source,
        lab: row.type === 'LAB_RESULT'
          ? { documentId: row.document_id, labName: row.lab_name ?? row.notes, total: row.total ?? 0, flagged: row.flagged ?? 0 }
          : null,
        med: row.type === 'MED_ADMIN' ? eventMeta(row) : null,
        milestone: row.type === 'MILESTONE' ? eventMeta(row) : null,
        infusion: row.type === 'INFUSION' ? eventMeta(row) : null,
        symptom: symptomSummary(row),
        note: row.type === 'NOTE' && row.source === 'notes' ? { id: row.note_id || null } : null,
      };
    });
    const last = rows[rows.length - 1];
    const nextCursor = r.rows.length > limit && last ? encodeCursor(last.occurred_at, last.id) : null;
    return { items, nextCursor, tz };
  });
}
