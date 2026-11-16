/**
 * AI commentary on one lab document: gathers the document's results, the previous
 * values of the same markers, and the therapy context, asks the model for a short
 * commentary in the user's language, stores it in ai_comments.
 */
import { pool } from './db.js';
import { markerName } from './canonical.js';
import { llmChat } from './llm.js';
import { patientPrompt } from './aiPrompts.js';
import { buildPatientProfile, aiDay } from './patientProfile.js';
import { aiNumber } from './aiFormat.js';
import { doseNote, doseUnit } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { displayUnit } from '../../../shared/units.js';

export async function buildLabDocumentContext(userId, documentId, language) {
  const say = (key, args) => t(language, `aiContext.labs.${key}`, args);
  const fmt = (n) => aiNumber(n, 3, language);
  const dateRu = (d) => aiDay(d, language);
  const unitRu = (u) => doseUnit(u, language);
  const d = await pool.query(
    `select d.id, d.lab_name, d.doc_date::text as doc_date, d.created_at, a.event_id
       from ingest_documents d
       left join attachments a on a.user_id = d.user_id and a.sha256 = d.sha256
      where d.user_id = $1 and d.id = $2 limit 1`,
    [userId, documentId]
  );
  const doc = d.rows[0];
  if (!doc) return null;
  const docDate = doc.doc_date || String(doc.created_at).slice(0, 10);

  const results = doc.event_id ? (await pool.query(
    `select t.code, t.canonical_key as key, t.category, r.value_numeric, r.value_text, r.unit_canonical as unit, r.ref_low, r.ref_high, r.collected_at
       from lab_results_eff r join lab_tests t on t.id = r.test_id
      where r.user_id = $1 and r.source_event_id = $2
      order by t.category, t.canonical_key nulls last, t.code`,
    [userId, doc.event_id]
  )).rows : [];

  const keys = [...new Set(results.map((r) => r.key).filter(Boolean))];
  const prev = keys.length ? (await pool.query(
    `select * from (
       select t.canonical_key as key, r.collected_at, r.value_numeric, r.unit_canonical as unit, r.lab_name,
              row_number() over (partition by t.canonical_key order by r.collected_at desc) as rn
         from lab_results_eff r join lab_tests t on t.id = r.test_id
        where r.user_id = $1 and t.canonical_key = any($2) and r.value_numeric is not null and r.collected_at < $3::date
     ) x where rn <= 3 order by key, collected_at desc`,
    [userId, keys, docDate]
  )).rows : [];
  const prevByKey = new Map();
  for (const p of prev) { if (!prevByKey.has(p.key)) prevByKey.set(p.key, []); prevByKey.get(p.key).push(p); }

  const [regimen, doses] = await Promise.all([
    pool.query(`select r.start_date::text as start_date, m.name, ri.dose_value, ri.dose_unit
                  from regimens r join regimen_items ri on ri.regimen_id = r.id join medications m on m.id = ri.medication_id
                 where r.user_id = $1 and (r.end_date is null or r.end_date > now()) order by r.start_date desc limit 1`, [userId]),
    pool.query(`select effective_from::text as effective_from, dose_value, dose_unit, reason from dose_changes where user_id = $1 order by effective_from`, [userId]),
  ]);

  const lines = [];
  lines.push(say('document', { lab: doc.lab_name || say('labUnknown'), date: dateRu(docDate) }));
  const reg = regimen.rows[0];
  if (reg) lines.push(say('therapy', { name: reg.name, dose: fmt(reg.dose_value), unit: unitRu(reg.dose_unit), date: dateRu(reg.start_date) }).replace(/\s+/g, ' '));
  if (doses.rows.length) lines.push(t(language, 'aiContext.profile.doseChanges', { list: doses.rows.map((x) => `${dateRu(x.effective_from)} → ${fmt(x.dose_value)} ${unitRu(x.dose_unit)}${x.reason ? ` (${doseNote(x.reason, language)})` : ''}`).join('; ') }));
  lines.push('');
  lines.push(say('resultsHead'));
  let flagged = 0;
  for (const r of results) {
    const name = r.key ? markerName(r.key, language) : r.code;
    const v = r.value_numeric != null ? fmt(r.value_numeric) : (r.value_text || '');
    const ref = r.ref_low != null && r.ref_high != null ? `${fmt(r.ref_low)}–${fmt(r.ref_high)}` : r.ref_low != null ? `≥${fmt(r.ref_low)}` : r.ref_high != null ? `≤${fmt(r.ref_high)}` : '';
    let flag = '';
    if (r.value_numeric != null) {
      if (r.ref_high != null && Number(r.value_numeric) > Number(r.ref_high)) { flag = say('high'); flagged++; }
      else if (r.ref_low != null && Number(r.value_numeric) < Number(r.ref_low)) { flag = say('low'); flagged++; }
      else if (ref) flag = say('normal');
    }
    const cat = r.category === 'urine' ? t(language, 'aiContext.urine') : '';
    lines.push(`${name}${cat} | ${v} | ${displayUnit(r.unit, language) || ''} | ${ref} | ${flag}`);
  }
  if (!results.length) lines.push(say('noResults'));

  const withHistory = keys.filter((k) => prevByKey.has(k));
  if (withHistory.length) {
    lines.push('');
    lines.push(say('previousHead'));
    for (const k of withHistory) {
      lines.push(`${markerName(k, language)}: ` + prevByKey.get(k).map((p) => `${dateRu(p.collected_at)} ${fmt(p.value_numeric)} ${displayUnit(p.unit, language) || ''}`.trim()).join('; '));
    }
  }
  return { doc, docDate, text: lines.join('\n'), resultCount: results.length, flagged };
}

export async function commentLabDocument(userId, documentId) {
  const language = await userLanguage(userId);
  const ctx = await buildLabDocumentContext(userId, documentId, language);
  if (!ctx) return null;
  const say = (key, args) => t(language, `aiContext.labs.${key}`, args);
  const profile = await buildPatientProfile(userId, { language });
  const userText = `${profile ? `${t(language, 'aiContext.ask.patientData')}\n${profile}\n\n` : ''}${say('section')}\n${ctx.text}\n\n${say('ask')}`;
  const out = await llmChat({ system: patientPrompt(language, 'labs'), user: userText, maxTokens: 1500, tier: 'fast', language });
  const text = out.text.trim();
  if (!text) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(
    'insert into ai_comments (user_id, subject_type, subject_id, model, text, usage, context) values ($1,$2,$3,$4,$5,$6,$7) returning id, model, text, usage, created_at, context',
    [userId, 'lab_document', documentId, out.model, text, JSON.stringify(out.usage || {}), `${out.promptTag}\n${userText}`]
  );
  return r.rows[0];
}

export async function latestComment(userId, subjectType, subjectId) {
  const r = await pool.query(
    'select id, model, text, usage, created_at, context from ai_comments where user_id=$1 and subject_type=$2 and subject_id=$3 order by created_at desc limit 1',
    [userId, subjectType, subjectId]
  );
  return r.rows[0] || null;
}
