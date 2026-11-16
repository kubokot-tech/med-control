/** symptom_entries row → API entry (camelCase, every catalog scale). Pure: no database, safe for prompt modules. */
import { SCALE_CATALOG } from './diaryScales.js';

export function rowToEntry(r) {
  const num = (v) => (v == null ? null : Number(v));
  const extra = r.scales && typeof r.scales === 'object' ? r.scales : {};
  const e = {
    date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
    wellbeing: r.wellbeing,
    tempC: num(r.temp_c), bpSys: r.bp_sys, bpDia: r.bp_dia, weightKg: num(r.weight_kg), pulse: r.pulse, steps: r.steps, notes: r.notes,
    updatedAt: r.updated_at,
  };
  for (const s of SCALE_CATALOG) e[s.key] = s.column ? (r[s.column] ?? null) : (extra[s.key] ?? null);
  return e;
}
