/**
 * Commit a labs PDF: parse through the ingestion service, store the file, write
 * event + attachment + document + raw observations + lab_results, raise alerts.
 * Shared by the web upload route and the Telegram bot.
 */
import * as fileStore from './files.js';
import { pool, transaction } from './db.js';
import { classify, markerName, entry as catalogEntry } from './canonical.js';
import { labFindings, raiseAlerts } from './alerts.js';
import { flag } from './labsQuery.js';
import { toCanonical, formatValueText, cleanUnit, comparatorOf } from './units.js';
import crypto from 'node:crypto';
import { parseLabsWithAi } from './labsAiParse.js';
import { llmConfig } from './llm.js';
import { addEvent } from './feed.js';
import { parseLabsPdf, pdfEngine } from './pdfEngine.js';
import { DEFAULT_TZ, todayKey } from './dates.js';
import { invalid } from './errors.js';
import { userFormat, userLanguage } from './userLocale.js';
import { t } from './i18n.js';

/**
 * Test code for lab_tests: the raw name, plus « (моча)» when the name is ambiguous («Лейкоциты», «Эритроциты»)
 * but the unit is cells per µl, which only urinalysis reports. Keeps urine cells out of the blood WBC/RBC series.
 */
export function testCode(o) {
  const name = String(o.test_name_raw || '').trim();
  const unit = String(o.unit_raw || '');
  // urine microscopy reports cells per µl or per field; blood counts use 10^9/л, тыс/мкл, млн/мкл, 10*3/мкл etc.
  const urineUnit = /^\s*(кл(ет(ки|ок)?)?\.?|количество|кол-?во|шт\.?|cells)?\s*\/\s*мкл\s*$|в\s*п\/?\s*з|п\/зр/i.test(unit) && !/млн|тыс|10\s*[\^*x×]|10[⁰¹²³⁴⁵⁶⁷⁸⁹]/i.test(unit);
  if (/^(лейкоцит|эритроцит)/i.test(name) && !/моч|урин/i.test(name) && urineUnit) return `${name} (моча)`;
  return name;
}

// Non-informative qualitative observations: kept in raw, skipped in lab_results.
const SKIP_PATTERNS = [
  /^цвет$/i, /^прозрачность$/i, /^запах$/i, /^слизь$/i,
  /^(реакция|ph)\s*(мочи)?$/i,
  /^эпителий/i, /^бактерии/i, /^дрожжев/i, /^цилиндр/i,
  /^кристалл/i, /^соли/i, /^сперматозоид/i,
  /^кровь\s*полуколичественно/i,
];
const QUALITATIVE_VALUES = /^(прозрачн|мутн|слабо-?мутн|соломенн|жёлт|желт|светло|тёмн|темн|янтарн|не\s*обнаруж|отрицательн|положительн|норм|отсутств|обнаруж|следы|незначит|ед\b|единич)/i;

export function shouldSkipObs(o) {
  // the urine mark parsers add («Цвет (моча)») does not change what the row is
  const code = (o.test_name_raw || '').trim().replace(/\s*\(моча\)$/i, '');
  if (!code) return true;
  if (SKIP_PATTERNS.some((rx) => rx.test(code))) return true;
  if (o.result_num == null && o.result_text && QUALITATIVE_VALUES.test(o.result_text.trim())) return true;
  return false;
}

const LABS_AREA = 'uploads';
const PENDING_AREA = 'uploads/pending';

/** Out-of-range results [{ key, code, value, unit, refLow, refHigh }] with display names, for summaries (Telegram reply, upload screen). */
export function flaggedResults(rows, language) {
  const out = [];
  for (const r of rows) {
    const dir = flag(r.value, r.refLow, r.refHigh);
    if (dir === 'high' || dir === 'low') out.push({ name: markerName(r.key || r.code, language) || r.code, value: r.value, unit: r.unit || '', dir });
  }
  return out;
}

/** Built-in parsers (Python ingestion service or the JS port, see pdfEngine.js). Throws { code: 'ingestion_failed', detail }. */
export const parseWithIngestion = (buf, filename) => parseLabsPdf(buf, filename);

/** Pending AI drafts waiting for the user's confirmation: PDF + JSON side by side. */
export async function savePending(buf, draft) {
  await fileStore.put(PENDING_AREA, `${draft.sha256}.pdf`, buf);
  await fileStore.put(PENDING_AREA, `${draft.sha256}.json`, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
}
/** Full sha of a pending draft from a 16-char prefix (Telegram callback_data is limited to 64 bytes). */
export async function resolvePending(prefix) {
  if (!/^[a-f0-9]{16,64}$/i.test(prefix)) return null;
  if (prefix.length === 64) return prefix;
  try { const n = (await fileStore.list(PENDING_AREA)).find((x) => x.name.startsWith(prefix) && x.name.endsWith('.json')); return n ? n.name.slice(0, 64) : null; } catch { return null; }
}
export async function loadPending(sha256) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null;
  try {
    const draft = JSON.parse(await fileStore.readText(fileStore.refOf(PENDING_AREA, `${sha256}.json`)));
    const buf = await fileStore.read(fileStore.refOf(PENDING_AREA, `${sha256}.pdf`));
    return { draft, buf };
  } catch { return null; }
}
/** Remove pending drafts older than `days` (called at start). */
export async function sweepPending(days = 7, log = console) {
  let removed = 0;
  try {
    const cutoff = Date.now() - days * 86400000;
    for (const f of await fileStore.list(PENDING_AREA)) {
      try { if (f.mtimeMs < cutoff && await fileStore.remove(f.ref)) removed++; } catch { /* ignore */ }
    }
  } catch { return 0; }
  if (removed) log.info(`pending drafts: removed ${removed} files older than ${days} days`);
  return removed;
}
export async function dropPending(sha256) {
  if (!/^[a-f0-9]{64}$/i.test(String(sha256))) return;
  for (const ext of ['pdf', 'json']) await fileStore.remove(fileStore.refOf(PENDING_AREA, `${sha256}.${ext}`)).catch(() => {});
}

/**
 * Parse with the fixed parsers; when they do not recognise the document and the model is
 * configured, parse with the model and return a draft for review instead of committing.
 */
export async function parseAny({ userId, buf, filename }) {
  if (!buf || buf.subarray(0, 5).toString('latin1') !== '%PDF-') { const e = new Error('not a PDF'); e.code = 'not_pdf'; throw e; }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const exists = await pool.query('select id, lab_name, doc_date::text as doc_date from ingest_documents where user_id=$1 and sha256=$2', [userId, sha256]);
  if (exists.rows.length) return { already: true, sha256, documentId: exists.rows[0].id, labName: exists.rows[0].lab_name, docDate: exists.rows[0].doc_date };
  try {
    return { parsed: await parseWithIngestion(buf, filename), via: pdfEngine() === 'js' ? 'js' : 'ingestion' };
  } catch (e) {
    if (e.code !== 'ingestion_failed' || !llmConfig().enabled) throw e;
    const draft = await parseLabsWithAi({ buf, filename, language: await userLanguage(userId) });
    if (draft.doc_date && !/^\d{4}-\d{2}-\d{2}$/.test(draft.doc_date)) draft.doc_date = null;
    if (!draft.observations.length) { const err = new Error('ai found no results'); err.code = 'ai_empty'; err.warnings = draft.warnings; throw err; }
    await savePending(buf, { ...draft, filename });
    return { needsReview: true, via: 'ai', sha256: draft.sha256, draft: { lab_name: draft.lab_name, doc_date: draft.doc_date, observations: draft.observations, warnings: draft.warnings, model: draft.model } };
  }
}

/** Fixed-parser path used by the API and the bot; falls back to an AI draft (see parseAny). */
export async function commitLabsPdf({ userId, buf, filename }) {
  const r = await parseAny({ userId, buf, filename });
  if (r.already) return { sha256: r.sha256, inserted: 0, already: true, documentId: r.documentId, labName: r.labName, docDate: r.docDate, flagged: [], alertsRaised: 0 };
  if (r.needsReview) return r;
  return commitParsed({ userId, buf, filename, parsed: r.parsed });
}

/** Write a parsed document: file, event, attachment, document, raw observations, results, alerts. */
/** The catalog key of an observation: the one chosen by hand (manual entry) or recognised from its name. */
function keyOf(o, code) {
  if (o.key && catalogEntry(o.key)) return { key: o.key, category: catalogEntry(o.key).category };
  return classify(code);
}

export async function commitParsed({ userId, buf, filename, parsed, manual = false }) {
  // manual entry (commitManual) has no file: no PDF check, no stored file, no attachment
  if (!manual && (!buf || buf.subarray(0, 5).toString('latin1') !== '%PDF-')) { const e = new Error('not a PDF'); e.code = 'not_pdf'; throw e; }
  const j = { ...parsed, source: parsed.source || 'ai_pdf_v1' };
  const sha256 = j.sha256 || crypto.createHash('sha256').update(buf).digest('hex');

  const exists = await pool.query('select id from ingest_documents where user_id=$1 and sha256=$2', [userId, sha256]);
  if (exists.rows.length) {
    return { sha256, inserted: 0, already: true, documentId: exists.rows[0].id, labName: j.lab_name || null, docDate: j.doc_date || null, flagged: [], alertsRaised: 0 };
  }

  // Store the file outside the transaction (file writes can't be rolled back).
  const filePath = manual ? null : await fileStore.put(LABS_AREA, `${sha256}.pdf`, buf);
  const format = await userFormat(userId); // numbers in alert texts; read before the transaction holds the connection

  return transaction(async (client) => {
    const occurredAt = (j.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(j.doc_date) ? `${j.doc_date}T00:00:00Z` : new Date().toISOString());
    if (j.doc_date && !/^\d{4}-\d{2}-\d{2}$/.test(j.doc_date)) j.doc_date = null;

    const eventId = await addEvent(client, userId, { type: 'LAB_RESULT', occurredAt, title: t(format.language, manual ? 'feedTitles.labsManual' : 'feedTitles.labsPdf'), notes: j.lab_name || null, meta: { lab: j.lab_name || null, source: j.source || 'unknown' }, source: `ingestion:${j.source || 'unknown'}` });

    if (!manual) {
      await client.query(
        'insert into attachments (user_id, event_id, file_url, mime_type, sha256) values ($1,$2,$3,$4,$5)',
        [userId, eventId, filePath, 'application/pdf', sha256]
      );
    }

    const docIns = await client.query(
      'insert into ingest_documents (user_id, source, sha256, filename, lab_name, doc_date, event_id) values ($1,$2,$3,$4,$5,$6,$7) returning id',
      [userId, j.source || 'mknc_pdf_v1', sha256, filename || null, j.lab_name || null, j.doc_date || null, eventId]
    );
    const ingestDocId = docIns.rows[0].id;

    const obs = j.observations || [];
    if (obs.length > 0) {
      const phObs = obs.map((_, i) => `($${i * 8 + 1},$${i * 8 + 2},$${i * 8 + 3},$${i * 8 + 4},$${i * 8 + 5},$${i * 8 + 6},$${i * 8 + 7},$${i * 8 + 8})`).join(',');
      const valsObs = obs.flatMap((o) => [ingestDocId, o.test_name_raw, o.result_text ?? null, o.result_num ?? null, o.unit_raw ?? null, o.ref_text_raw ?? null, o.ref_low ?? null, o.ref_high ?? null]);
      await client.query(
        `insert into ingest_observations_raw (document_id, test_name_raw, result_text, result_num, unit_raw, ref_text_raw, ref_low, ref_high) values ${phObs}`,
        valsObs
      );
    }

    const validObs = obs.filter((o) => o.test_name_raw?.trim() && !shouldSkipObs(o)).map((o) => ({ ...o, unit_raw: cleanUnit(o.unit_raw) }));
    let inserted = 0;
    let alertsRaised = 0;
    let committed = [];
    if (validObs.length > 0) {
      const testIdMap = new Map();
      for (const o of validObs) {
        const code = testCode(o);
        const { key: canonicalKey, category } = keyOf(o, code);
        const t = await client.query(
          'insert into lab_tests (code, name, category, canonical_unit, canonical_key) values ($1,$2,$3,$4,$5) on conflict (code) do update set name=excluded.name, category=excluded.category, canonical_key=excluded.canonical_key returning id',
          [code, code, category, o.unit_raw ?? null, canonicalKey]
        );
        testIdMap.set(code, t.rows[0].id);
      }

      const phRes = validObs.map((_, i) => `($${i * 12 + 1},$${i * 12 + 2},$${i * 12 + 3},$${i * 12 + 4},$${i * 12 + 5},$${i * 12 + 6},$${i * 12 + 7},$${i * 12 + 8},$${i * 12 + 9},$${i * 12 + 10},$${i * 12 + 11},$${i * 12 + 12})`).join(',');
      const valsRes = validObs.flatMap((o) => {
        const code = testCode(o);
        const key = keyOf(o, code).key;
        // Values, refs and the canonical unit are stored converted to the catalog unit (see units.js).
        const c = key ? toCanonical(key, o.result_num ?? null, o.unit_raw, o.ref_low ?? null, o.ref_high ?? null) : { value: o.result_num ?? null, refLow: o.ref_low ?? null, refHigh: o.ref_high ?? null, unit: o.unit_raw ?? null };
        // a converted value keeps the report's «<» / «>»: «<0,6 мг/дл» stays a bound, not an exact number
        const text = c.status === 'converted' && o.result_num != null ? `${comparatorOf(o.result_text)}${formatValueText(c.value)}` : (o.result_text ?? null);
        return [userId, testIdMap.get(code), occurredAt, c.value, text, o.unit_raw ?? null, c.unit || null, c.refLow, c.refHigh, j.lab_name ?? null, eventId, ingestDocId];
      });
      await client.query(
        `insert into lab_results (user_id, test_id, collected_at, value_numeric, value_text, unit_original, unit_canonical, ref_low, ref_high, lab_name, source_event_id, document_id) values ${phRes}`,
        valsRes
      );
      inserted = validObs.length;

      // Alert rules and the out-of-range list on the committed values, against the ranges in force (lab_results_eff:
      // the user's own, the built-in one or the lab's), read back inside this transaction.
      committed = (await client.query(
        `select t.canonical_key as key, t.code, r.value_numeric, r.unit_canonical, r.ref_low, r.ref_high
         from lab_results_eff r join lab_tests t on t.id = r.test_id where r.document_id = $1 order by r.id`,
        [ingestDocId]
      )).rows.map((x) => ({ key: x.key, code: x.code, value: x.value_numeric != null ? Number(x.value_numeric) : null, unit: x.unit_canonical, refLow: x.ref_low != null ? Number(x.ref_low) : null, refHigh: x.ref_high != null ? Number(x.ref_high) : null }));
      alertsRaised = await raiseAlerts(client, userId, labFindings(committed, { eventId, format }), new Date(occurredAt));
    }

    return { sha256, inserted, already: false, eventId, documentId: ingestDocId, labName: j.lab_name || null, docDate: j.doc_date || null, flagged: flaggedResults(committed, format.language), alertsRaised };
  });
}

const MANUAL_NUM = /^\s*([<>≤≥]=?)?\s*([+-]?\d+(?:[.,]\d+)?)\s*$/;

/**
 * Results typed by hand (Анализы → Загрузить → «Ввести вручную»): rows { key?, name?, value, unit?, refLow?, refHigh? }.
 * `value` as written: «5,5», «<0,6», «отрицательно»; a chosen catalog key wins over the name. Goes the same way as a
 * parsed PDF (units, ranges, alerts, feed), just without a file; the document's source is «manual».
 */
export async function commitManual(userId, { date, labName, rows }, { tz = DEFAULT_TZ } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw invalid('bad_date');
  if (date > todayKey(tz)) throw invalid('future_date');
  const observations = [];
  for (const r of rows || []) {
    const e = r.key ? catalogEntry(r.key) : null;
    if (r.key && !e) throw invalid('unknown_key');
    const name = e ? e.name : String(r.name || '').trim();
    const value = String(r.value ?? '').trim();
    if (!name || !value) continue;
    const m = MANUAL_NUM.exec(value);
    const lo = r.refLow == null || r.refLow === '' ? null : Number(r.refLow);
    const hi = r.refHigh == null || r.refHigh === '' ? null : Number(r.refHigh);
    observations.push({
      key: e?.key ?? null, test_name_raw: name, result_text: value, result_num: m ? Number(m[2].replace(',', '.')) : null,
      unit_raw: String(r.unit || '').trim() || e?.unit || null, ref_low: Number.isFinite(lo) ? lo : null, ref_high: Number.isFinite(hi) ? hi : null,
      ref_text_raw: lo != null || hi != null ? `${lo ?? ''}-${hi ?? ''}` : null,
    });
  }
  if (!observations.length) throw invalid('nothing_to_save');
  const sha256 = crypto.createHash('sha256').update(`manual:${userId}:${Date.now()}:${crypto.randomUUID()}`).digest('hex');
  return commitParsed({ userId, manual: true, filename: null, parsed: { source: 'manual', sha256, lab_name: String(labName || '').trim() || null, doc_date: date, observations } });
}
