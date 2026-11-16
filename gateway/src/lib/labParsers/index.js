/**
 * Built-in laboratory parsers in JavaScript: a port of ingestion/app/connectors (registry.py) for running without the
 * Python service (PDF_ENGINE=js, and later the local app). Same contract: META, detect(text), parseText(text) on the
 * text layer of the PDF. The Python parsers are the reference; the shared fixtures in ingestion/tests/fixtures and
 * their .expected.json keep the two in step (see docs/LAB-PARSERS.md).
 */
import * as dnkomPdfV1 from './dnkomPdfV1.js';
import * as hadassahPdfV1 from './hadassahPdfV1.js';
import * as helixPdfV1 from './helixPdfV1.js';
import * as mkncPdfV1 from './mkncPdfV1.js';

// Order matters: specific detectors first; fallback parsers are tried last on documents nobody claims.
export const PARSERS = [helixPdfV1, hadassahPdfV1, dnkomPdfV1, mkncPdfV1];

export const byId = (id) => PARSERS.find((p) => p.META.id === id) || null;

/** Parsers to try for this text: those that detect it, then fallbacks. */
export function candidates(text) {
  const hit = PARSERS.filter((p) => p.detect(text));
  return [...hit, ...PARSERS.filter((p) => p.META.fallback && !hit.includes(p))];
}

export const publicList = () => PARSERS.map(({ META: { id, name, country, description } }) => ({ id, name, country, description }));

/**
 * The first parser (or the given one) that finds observations, like the ingestion service's /ingest/labs/pdf:
 * { source, lab_name, doc_date, observations: [{ test_name_raw, result_text, result_num, unit_raw, ref_text_raw, ref_low, ref_high }] },
 * or null when nobody parses it. A parser that throws on a foreign layout simply does not match.
 */
export function parseLabText(text, source = 'auto') {
  const tried = source === 'auto' ? candidates(text) : [byId(source)].filter(Boolean);
  for (const p of tried) {
    let doc;
    try { doc = p.parseText(text); } catch { continue; }
    if (!doc.observations?.length) continue;
    return {
      source: p.META.id,
      lab_name: doc.lab_name ?? null,
      doc_date: doc.doc_date ?? null,
      observations: doc.observations.map((o) => ({
        test_name_raw: o.test_name || '', result_text: o.result_text ?? null, result_num: o.result_num ?? null, unit_raw: o.units ?? null,
        ref_text_raw: o.ref_text ?? null, ref_low: o.ref_low ?? null, ref_high: o.ref_high ?? null,
      })),
    };
  }
  return null;
}
