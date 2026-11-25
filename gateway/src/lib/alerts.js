/**
 * Alert rules evaluated when data is written (labs commit, symptoms save) and on demand.
 * Lab thresholds come from the treatment protocol (protocol.js); vital-sign rules are fixed here.
 * Severity: RED = call the doctor / act today, YELLOW = watch, mention at the next visit.
 * Each alert carries a dedup key so the same finding is not raised twice.
 */

import { toCanonical, comparatorOf } from './units.js';
import { definitely } from '../../../shared/labBounds.js';
import { currentLabRules, presetText } from './protocol.js';
import { presetRuleKeys } from './protocolPresets.js';
import { createFormat } from '../../../shared/format.js';
import { t, relocalize } from './i18n.js';

/** Declarative rule: { key, severity, op: lt|lte|gt|gte|gtRef|ltRef, value, message }. gtRef/ltRef compare with value × ref.high / ref.low. */
export function ruleHits(rule, v, ref, comparator = '') {
  if (rule.op === 'gtRef') return ref?.high != null && definitely(v, comparator, 'gt', rule.value * ref.high);
  if (rule.op === 'ltRef') return ref?.low != null && definitely(v, comparator, 'lt', rule.value * ref.low);
  return ['lt', 'lte', 'gt', 'gte'].includes(rule.op) && definitely(v, comparator, rule.op, rule.value);
}
/** Message template: {v} value, {u} unit, {ref} the reference bound the rule used (high for gtRef, low for ltRef). */
export function renderRuleMessage(rule, v, u, ref) {
  const bound = rule.op === 'ltRef' ? ref?.low : ref?.high;
  return String(rule.message).replace(/\{v\}/g, v).replace(/\{u\}/g, u || '').replace(/\{ref\}/g, bound ?? '?').replace(/\{refHigh\}/g, ref?.high ?? '?').replace(/\{refLow\}/g, ref?.low ?? '?').replace(/\s+/g, ' ').trim();
}

const DEFAULT_FORMAT = createFormat();

/** results: [{ key, value, unit, refLow, refHigh, code }]; rules default to the current treatment protocol; numbers in `format` (userFormat). */
export function labFindings(results, { eventId, date, rules, format = DEFAULT_FORMAT } = {}) {
  const fmt = (v) => format.number(v, { maximumFractionDigits: 2 });
  const out = [];
  const labRules = rules || currentLabRules();
  const rank = { RED: 2, YELLOW: 1 };
  for (const r of results) {
    if (r.key == null || r.value == null) continue;
    const raw = Number(r.value);
    if (Number.isNaN(raw)) continue;
    const norm = toCanonical(r.key, raw, r.unit, r.refLow, r.refHigh);
    if (norm.status !== 'same' && norm.status !== 'converted') continue;
    const v = norm.value;
    const cmp = comparatorOf(r.valueText);
    const ref = { low: norm.refLow, high: norm.refHigh };
    // One finding per marker per event: the most severe matching rule, first declared among equals.
    let hit = null;
    for (const rule of labRules) {
      if (rule.key !== r.key || !ruleHits(rule, v, ref, cmp)) continue;
      if (!hit || (rank[rule.severity] || 0) > (rank[hit.severity] || 0)) hit = rule;
    }
    if (!hit) continue;
    // the rule's words in the user's language (a preset text) or as the user wrote them; the unit as the language writes it
    const rule = { ...hit, message: presetText(hit.message, format.language) };
    out.push({
      scope: 'LAB',
      key: r.key,
      severity: hit.severity,
      message: renderRuleMessage(rule, cmp + fmt(v), format.unit(norm.unit), { low: ref.low != null ? fmt(ref.low) : null, high: ref.high != null ? fmt(ref.high) : null }),
      dedup: `lab:${r.key}:${eventId || date || 'x'}`,
      context: { value: v, comparator: cmp, unit: norm.unit || null, refLow: ref.low, refHigh: ref.high, code: r.code || null, eventId: eventId || null, date: date || null, href: `/labs/series?key=${encodeURIComponent(r.key)}` },
    });
  }
  return out;
}

export function bpSeverity(sys, dia) {
  if (sys >= 160 || dia >= 100) return 2;
  if (sys >= 140 || dia >= 90) return 1;
  return 0;
}

export function symptomFindings(entry, date, language) {
  const out = [];
  const say = (key, args) => t(language, `alertTexts.${key}`, args);
  const push = (key, severity, message) => out.push({ scope: 'VITAL', key, severity, message, dedup: `sym:${key}:${severity}:${date}`, context: { date, href: '/symptoms' } });
  if (entry.bpSys != null && entry.bpDia != null) {
    if (bpSeverity(entry.bpSys, entry.bpDia) === 2) push('BP', 'RED', say('bpRed', { sys: entry.bpSys, dia: entry.bpDia }));
    else if (bpSeverity(entry.bpSys, entry.bpDia) === 1) push('BP', 'YELLOW', say('bpYellow', { sys: entry.bpSys, dia: entry.bpDia }));
  }
  if (entry.tempC != null && entry.tempC >= 38) push('TEMP', 'RED', say('tempRed', { t: entry.tempC }));
  if (entry.diarrhea === 3) push('DIARRHEA', 'YELLOW', say('diarrhea'));
  if (entry.handFoot === 3) push('HFS', 'YELLOW', say('handFoot'));
  if (entry.nausea === 3) push('NAUSEA', 'YELLOW', say('nausea'));
  return out;
}

/** Insert findings that are not yet present (by dedup key). Returns inserted count. */
export async function raiseAlerts(client, userId, findings, triggeredAt = new Date()) {
  let inserted = 0;
  for (const f of findings) {
    const dup = await client.query(`select 1 from alerts where user_id = $1 and context->>'dedup' = $2 limit 1`, [userId, f.dedup]);
    if (dup.rows.length) continue;
    await client.query(
      `insert into alerts (user_id, rule_id, triggered_at, status, context)
       values ($1, null, $2, 'OPEN', $3)`,
      [userId, triggeredAt, JSON.stringify({ ...f.context, dedup: f.dedup, scope: f.scope, key: f.key, severity: f.severity, message: f.message })]
    );
    inserted++;
  }
  return inserted;
}

const ALERT_KEYS = ['bpRed', 'bpYellow', 'tempRed', 'diarrhea', 'handFoot', 'nausea', 'ivcG6pd'].map((k) => `alertTexts.${k}`);

/**
 * The text of a stored alert for the reader. It was written in the language of that day; one of our own messages
 * follows the reader, with the value and the unit taken from the alert. A text the user wrote stays as stored.
 */
export function alertMessage(c, format) {
  const number = (v) => format.number(v, { maximumFractionDigits: 2 });
  return relocalize(c.message, [...ALERT_KEYS, ...presetRuleKeys()], format.language, (a) => ({
    ...a,
    ...(c.value != null && a.v != null ? { v: (c.comparator || '') + number(c.value) } : {}),
    ...(a.u != null ? { u: format.unit(c.unit) ?? a.u } : {}),
    ...(a.ref != null && (c.refHigh ?? c.refLow) != null ? { ref: number(c.refHigh ?? c.refLow) } : {}),
  }));
}

export function rowToAlert(r, format = DEFAULT_FORMAT) {
  const c = r.context || {};
  return {
    id: r.id,
    triggeredAt: r.triggered_at,
    status: r.status,
    scope: c.scope,
    key: c.key,
    severity: c.severity,
    message: alertMessage(c, format),
    href: c.href || null,
    date: c.date || null,
    value: c.value ?? null,
  };
}
