/** Pure parsers for Apple Health data (no database): Health Auto Export JSON and export.xml lines. */
/** "2026-09-10 08:12:00 +0300" | ISO → Date or null */
export function parseHealthDate(s) {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?$/.exec(String(s).trim());
  const d = m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4] || '00'}`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
export function temperature(qty, units) {
  if (!Number.isFinite(qty)) return null;
  const unit = String(units ?? '').trim().toLowerCase();
  if (['°c', 'degc', 'c', 'celsius'].includes(unit)) return { qty, units: 'degC' };
  if (['°f', 'degf', 'f', 'fahrenheit'].includes(unit)) return { qty: Math.round((qty - 32) * 5 / 9 * 10) / 10, units: 'degC' };
  return null;
}
const KIND_ALIASES = { blood_pressure: 'blood_pressure', weight_body_mass: 'weight_body_mass', body_mass: 'weight_body_mass', weight: 'weight_body_mass', body_temperature: 'body_temperature', heart_rate: 'heart_rate', resting_heart_rate: 'resting_heart_rate', step_count: 'step_count', steps: 'step_count' };

/** Health Auto Export payload → [{ kind, ts, value }] (unknown metrics kept as-is under their name). */
export function parseHealthAutoExport(payload) {
  const metrics = payload?.data?.metrics || payload?.metrics || [];
  const out = [];
  for (const m of metrics) {
    const kind = KIND_ALIASES[String(m.name || '').toLowerCase()] || String(m.name || '').toLowerCase();
    if (!kind) continue;
    for (const d of m.data || []) {
      const ts = parseHealthDate(d.date);
      if (!ts) continue;
      const value = { units: m.units || null };
      if (kind === 'blood_pressure') { value.systolic = num(d.systolic); value.diastolic = num(d.diastolic); if (value.systolic == null || value.diastolic == null) continue; }
      else if (kind === 'heart_rate') { value.min = num(d.Min ?? d.min); value.avg = num(d.Avg ?? d.avg ?? d.qty); value.max = num(d.Max ?? d.max); if (value.avg == null) continue; }
      else { value.qty = num(d.qty ?? d.value ?? d.Avg); if (value.qty == null) continue; }
      if (kind === 'weight_body_mass' && /lb/i.test(m.units || '')) { value.qty = Math.round(value.qty * 0.45359237 * 10) / 10; value.units = 'kg'; }
      if (kind === 'body_temperature') {
        const normalized = temperature(value.qty, value.units);
        if (!normalized) continue;
        Object.assign(value, normalized);
      }
      out.push({ kind, ts, value });
    }
  }
  return out;
}

/**
 * Apple Health export.xml, line by line (the file is one record per line). Yields the same samples as the JSON path.
 * Blood pressure comes as a Correlation with two nested Records; other quantities as single Records.
 */
export async function* parseHealthXml(lines) {
  const TYPES = { HKQuantityTypeIdentifierBodyMass: 'weight_body_mass', HKQuantityTypeIdentifierBodyTemperature: 'body_temperature', HKQuantityTypeIdentifierRestingHeartRate: 'resting_heart_rate', HKQuantityTypeIdentifierStepCount: 'step_count', HKQuantityTypeIdentifierHeartRate: 'heart_rate' };
  const attr = (line, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(line); return m ? m[1] : null; };
  let corr = null; // { ts, systolic, diastolic }
  for await (const line of lines) {
    if (line.includes('<Correlation type="HKCorrelationTypeIdentifierBloodPressure"')) { corr = { ts: parseHealthDate(attr(line, 'startDate')) }; continue; }
    if (corr && line.includes('</Correlation>')) { if (corr.ts && corr.systolic != null && corr.diastolic != null) yield { kind: 'blood_pressure', ts: corr.ts, value: { systolic: corr.systolic, diastolic: corr.diastolic, units: 'mmHg' } }; corr = null; continue; }
    if (!line.includes('<Record ')) continue;
    const type = attr(line, 'type');
    if (corr) {
      if (type === 'HKQuantityTypeIdentifierBloodPressureSystolic') corr.systolic = num(attr(line, 'value'));
      if (type === 'HKQuantityTypeIdentifierBloodPressureDiastolic') corr.diastolic = num(attr(line, 'value'));
      continue;
    }
    const kind = TYPES[type];
    if (!kind) continue;
    const ts = parseHealthDate(attr(line, 'startDate'));
    const v = num(attr(line, 'value'));
    if (!ts || v == null) continue;
    const units = attr(line, 'unit');
    if (kind === 'body_temperature') {
      const value = temperature(v, units);
      if (value) yield { kind, ts, value };
    } else if (kind === 'heart_rate') yield { kind, ts, value: { avg: v, min: v, max: v, units } };
    else if (kind === 'weight_body_mass' && /lb/i.test(units || '')) yield { kind, ts, value: { qty: Math.round(v * 0.45359237 * 10) / 10, units: 'kg' } };
    else yield { kind, ts, value: { qty: v, units } };
  }
}
