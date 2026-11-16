import { pool } from '../lib/db.js';
import { buildSummary } from '../lib/labsSummary.js';
import {
  UUID_RX, buildLabsWhere, readLabsQuery, sliceMonthsByRange,
  DOCUMENT_ID_SUBQUERY, mapSeriesPoints,
} from '../lib/labsQuery.js';
import { monthPickOrder } from '../lib/labsQuery.js';
import { classify, entry as catalogEntry, catalog, keyKeys, markerName, markerShort } from '../lib/canonical.js';
import { commitLabsPdf, commitParsed, commitManual, loadPending, dropPending } from '../lib/labsCommit.js';
import { z } from 'zod';
import { displayUnit } from '../../../shared/units.js';
import { labParserList } from '../lib/pdfEngine.js';
import { labSamplesUrl } from './labSample.js';
import { userLabUnits, displayPoint } from '../lib/labDisplay.js';
import { userLanguage } from '../lib/userLocale.js';

export default async function labsRoutes(app) {
  // Commit labs PDF: gateway receives PDF, calls ingestion to parse, then writes to Postgres.
  app.post('/labs/commit-pdf', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    let filePart = null;
    for await (const p of req.parts()) {
      if (p.type === 'file' && p.fieldname === 'file') {
        filePart = p;
        break;
      }
    }
    if (!filePart) return reply.code(400).send({ error: 'file_required' });

    const buf = await filePart.toBuffer();
    if (!buf?.length) return reply.code(400).send({ error: 'empty_file' });

    try {
      const r = await commitLabsPdf({ userId, buf, filename: filePart.filename });
      if (r.needsReview) return { ok: false, needsReview: true, sha256: r.sha256, draft: r.draft };
      return { ok: true, sha256: r.sha256, inserted: r.inserted, already: r.already, eventId: r.eventId, alertsRaised: r.alertsRaised, labName: r.labName, docDate: r.docDate };
    } catch (e) {
      if (e.code === 'not_pdf') return reply.code(415).send({ error: 'not_pdf', message: 'Файл не похож на PDF' });
      if (e.code === 'ingestion_failed') return reply.code(502).send({ error: 'ingestion_failed', message: 'Формат лаборатории не распознан встроенными парсерами, а ключ ИИ не задан: добавьте его в Настройках → «Помощник ИИ»' });
      if (e.code === 'ai_empty') return reply.code(422).send({ error: 'ai_empty', message: 'Модель не нашла в документе результатов анализов', warnings: e.warnings });
      if (e.code === 'provider' || e.code === 'bad_output' || e.code === 'refusal') return reply.code(502).send({ error: e.code, message: 'Модель не смогла разобрать документ' });
      throw e;
    }
  });

  // AI draft after the user's review: edited rows are committed, the pending files removed.
  const ReviewBody = z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    lab_name: z.string().max(200).nullable().optional(),
    doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    observations: z.array(z.object({
      test_name_raw: z.string().min(1).max(200),
      result_text: z.string().max(100).nullable().optional(),
      result_num: z.number().nullable().optional(),
      unit_raw: z.string().max(40).nullable().optional(),
      ref_text_raw: z.string().max(60).nullable().optional(),
      ref_low: z.number().nullable().optional(),
      ref_high: z.number().nullable().optional(),
    })).min(1).max(300),
  });
  app.post('/labs/commit-review', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = ReviewBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    const userId = req.user.sub;
    const b = parsed.data;
    const pending = await loadPending(b.sha256);
    if (!pending) return reply.code(404).send({ error: 'pending_not_found', message: 'Черновик не найден, загрузите файл ещё раз' });
    const r = await commitParsed({ userId, buf: pending.buf, filename: pending.draft.filename, parsed: { sha256: b.sha256, source: 'ai_pdf_v1', lab_name: b.lab_name ?? pending.draft.lab_name, doc_date: b.doc_date ?? pending.draft.doc_date, observations: b.observations.map((o) => ({ ...o, result_text: o.result_text ?? (o.result_num != null ? String(o.result_num) : null) })) } });
    await dropPending(b.sha256);
    return { ok: true, sha256: r.sha256, inserted: r.inserted, already: r.already, eventId: r.eventId, alertsRaised: r.alertsRaised, labName: r.labName, docDate: r.docDate };
  });
  app.get('/labs/pending/:sha', { preHandler: app.authenticate }, async (req, reply) => {
    const p = await loadPending(String(req.params?.sha || ''));
    if (!p) return reply.code(404).send({ error: 'pending_not_found' });
    const { savedAt, filename, sha256, lab_name, doc_date, observations, warnings, model } = p.draft;
    return { sha256, filename, savedAt, draft: { lab_name, doc_date, observations, warnings, model } };
  });
  app.delete('/labs/pending/:sha', { preHandler: app.authenticate }, async (req, reply) => {
    const sha = String(req.params?.sha || '');
    if (!/^[a-f0-9]{64}$/i.test(sha)) return reply.code(400).send({ error: 'bad_id' });
    await dropPending(sha);
    return { ok: true };
  });

  // Labs monthly summary (pivot): one value per month per test (?pick=worst|latest|max, default worst), with the count of measurements.
  // Laboratories the ingestion service parses without AI (Settings → «Лаборатории»).
  app.get('/labs/parsers', { preHandler: app.authenticate }, async () => ({ ...(await labParserList()), samples: { send: Boolean(labSamplesUrl()) } }));
  app.get('/labs/summary', { preHandler: app.authenticate }, async (req) => buildSummary(readLabsQuery(req)));

  // Labs series by canonical key with delta to previous point.
  app.get('/labs/series', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const key = (req.query?.key || '').toString().trim();
    if (!key) return { key: null, points: [] };

    const ce = catalogEntry(key);
    if (!ce) return reply.code(400).send({ error: 'unknown_key' });

    const r = await pool.query(
      `select r.collected_at, r.value_numeric, r.value_text, r.unit_canonical, r.ref_low, r.ref_high, r.ref_source, r.lab_ref_low, r.lab_ref_high,
              t.canonical_key as test,
              ${DOCUMENT_ID_SUBQUERY} as document_id
       from lab_results_eff r
       join lab_tests t on t.id=r.test_id
       where r.user_id=$1 and t.canonical_key=$2
       order by r.collected_at asc`,
      [userId, key]
    );

    const u = await userLabUnits(userId);
    const points = mapSeriesPoints(r.rows).map((p) => displayPoint(u, key, p));
    const units = [...new Set(points.map((p) => p.unit).filter(Boolean))];
    return { key, name: markerName(key, u.language), short: markerShort(key, u.language), unit: u.unit(key, ce.unit), units, mixedUnits: units.length > 1, last: points.length ? points[points.length - 1] : null, points };
  });

  // Labs series by raw test code (exact match): for drilling from summary.
  app.get('/labs/series-raw', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const test = (req.query?.test || '').toString().trim();
    if (!test) return reply.code(400).send({ error: 'test_required' });

    const r = await pool.query(
      `select r.collected_at, r.value_numeric, r.value_text, r.unit_canonical, r.ref_low, r.ref_high, r.ref_source, r.lab_ref_low, r.lab_ref_high, t.code as test,
              t.canonical_key,
              ${DOCUMENT_ID_SUBQUERY} as document_id
       from lab_results_eff r
       join lab_tests t on t.id=r.test_id
       where r.user_id=$1 and t.code=$2
       order by r.collected_at asc`,
      [userId, test]
    );

    const canonicalKey = r.rows[0]?.canonical_key ?? classify(test).key;
    const u = await userLabUnits(userId);
    const points = mapSeriesPoints(r.rows).map((p) => displayPoint(u, canonicalKey, p));
    return { test, canonicalKey, last: points.length ? points[points.length - 1] : null, points };
  });

  // Labs overview cards for dashboard: last value, delta, and a small tail of points.
  app.get('/labs/overview', { preHandler: app.authenticate }, async (req) => {
    const userId = req.user.sub;
    const keysRaw = (req.query?.keys || '').toString();
    const keys = keysRaw
      ? keysRaw.split(',').map((x) => x.trim()).filter(Boolean)
      : keyKeys();

    if (!keys.length) return { cards: [] };

    const r = await pool.query(
      `select r.collected_at, r.value_numeric, r.value_text, r.unit_canonical, r.ref_low, r.ref_high, r.ref_source, r.lab_ref_low, r.lab_ref_high,
              t.code as test, t.canonical_key as ckey
       from lab_results_eff r
       join lab_tests t on t.id=r.test_id
       where r.user_id=$1 and t.canonical_key = ANY($2::text[])
       order by t.canonical_key, r.collected_at asc`,
      [userId, keys]
    );

    const rowsByKey = new Map(keys.map((k) => [k, []]));
    for (const row of r.rows) rowsByKey.get(row.ckey)?.push(row);

    const u = await userLabUnits(userId);
    const cards = keys.map((key) => {
      const points = mapSeriesPoints(rowsByKey.get(key) || []).map((p) => displayPoint(u, key, p));
      const last = points.length ? points[points.length - 1] : null;
      if (last) delete last.documentId;
      return {
        key,
        short: markerShort(key, u.language),
        name: markerName(key, u.language),
        last,
        points: points.slice(-24).map((p) => ({ date: p.date, valueNum: p.valueNum, valueText: p.valueText })),
      };
    });

    return { cards };
  });

  // Marker catalog (keys, names, categories) for the frontend
  app.get('/labs/catalog', { preHandler: app.authenticate }, async (req) => {
    const language = await userLanguage(req.user.sub);
    return { items: catalog(language).map((c) => ({ ...c, unit: displayUnit(c.unit, language) })) };
  });

  // List committed lab documents
  app.get('/labs/documents', { preHandler: app.authenticate }, async (req) => {
    const userId = req.user.sub;
    const r = await pool.query(
      `select d.id, d.created_at, d.sha256, d.filename, d.lab_name, d.doc_date, d.source,
              a.mime_type,
              (select count(*) from ingest_observations_raw o where o.document_id=d.id) as obs_count,
              exists (select 1 from ai_comments c where c.user_id=d.user_id and c.subject_type='lab_document' and c.subject_id=d.id::text) as has_ai_comment
       from ingest_documents d
       left join attachments a on a.user_id=d.user_id and a.sha256=d.sha256
       where d.user_id=$1
       order by coalesce(d.doc_date, d.created_at) desc, d.created_at desc`,
      [userId]
    );
    return { documents: r.rows };
  });

  // Document detail (raw observations)
  // Results typed by hand (lib/labsCommit.js commitManual): for labs without a parser and without AI, or paper reports
  const ManualBody = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    labName: z.string().max(120).nullable().optional(),
    rows: z.array(z.object({
      key: z.string().max(20).nullable().optional(), name: z.string().max(120).nullable().optional(), value: z.string().max(40),
      unit: z.string().max(20).nullable().optional(), refLow: z.number().nullable().optional(), refHigh: z.number().nullable().optional(),
    })).min(1).max(80),
  });
  app.post('/labs/manual', { preHandler: app.authenticate }, async (req, reply) => {
    const p = ManualBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_body', details: p.error.issues });
    const r = await commitManual(req.user.sub, p.data, { tz: req.user.tz });
    return { ok: true, documentId: r.documentId, inserted: r.inserted, flagged: r.flagged, alertsRaised: r.alertsRaised };
  });

  app.get('/labs/documents/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const id = (req.params?.id || '').toString();
    if (!UUID_RX.test(id)) return reply.code(400).send({ error: 'bad_id' });

    const d = await pool.query(
      `select d.id, d.created_at, d.sha256, d.filename, d.lab_name, d.doc_date, d.source,
              a.mime_type
       from ingest_documents d
       left join attachments a on a.user_id=d.user_id and a.sha256=d.sha256
       where d.user_id=$1 and d.id=$2
       limit 1`,
      [userId, id]
    );
    if (!d.rows.length) return reply.code(404).send({ error: 'not_found' });

    const obs = await pool.query(
      `select test_name_raw, result_text, result_num, unit_raw, ref_text_raw, ref_low, ref_high
       from ingest_observations_raw
       where document_id=$1
       order by test_name_raw asc`,
      [id]
    );

    return { document: d.rows[0], observations: obs.rows };
  });
}
