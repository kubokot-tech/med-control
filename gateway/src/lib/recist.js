/**
 * RECIST 1.1 on target lesions: sum of longest diameters per study, compared with
 * baseline (first study) and nadir (smallest sum so far).
 * Studies are compared only within a modality group: CT and PET-CT together (lungs),
 * MRI separately (neck), so lymph nodes on MRI never add to lung sums.
 * studies: [{ id, date, modality?, createdAt? }], lesions: [{ id, isTarget, retired }], measurements: [{ studyId, lesionId, sizeMm }]
 */
import { has, t } from './i18n.js';
export function modalityGroup(modality) {
  const m = String(modality || '').toUpperCase();
  if (!m) return '';
  if (/КТ|CT|ПЭТ|PET/.test(m)) return 'КТ';
  if (/МРТ|MRI|MR/.test(m)) return 'МРТ';
  return m;
}

export function computeRecist(studies, lesions, measurements) {
  const targets = new Set(lesions.filter((l) => l.isTarget && !l.retired).map((l) => l.id));
  const byStudy = new Map();
  for (const m of measurements) {
    if (!targets.has(m.lesionId) || m.sizeMm == null) continue;
    if (!byStudy.has(m.studyId)) byStudy.set(m.studyId, []);
    byStudy.get(m.studyId).push(Number(m.sizeMm));
  }
  const ordered = studies.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1));
  const out = [];
  const state = new Map(); // group -> { baseline, nadir }
  for (const s of ordered) {
    const sizes = byStudy.get(s.id);
    if (!sizes || !sizes.length) continue;
    const group = modalityGroup(s.modality);
    const st = state.get(group) || { baseline: null, nadir: null };
    const sum = Math.round(sizes.reduce((a, b) => a + b, 0) * 10) / 10;
    let response;
    if (st.baseline == null) {
      response = 'baseline';
      st.baseline = sum;
      st.nadir = sum;
    } else if (sum === 0) {
      response = 'CR';
    } else if (sum <= 0.7 * st.baseline) {
      response = 'PR';
    } else if (sum >= 1.2 * st.nadir && sum - st.nadir >= 5) {
      response = 'PD';
    } else {
      response = 'SD';
    }
    out.push({
      studyId: s.id,
      date: s.date,
      group,
      sum,
      lesionCount: sizes.length,
      baseline: st.baseline,
      nadir: st.nadir,
      changeFromBaselinePct: st.baseline ? Math.round(((sum - st.baseline) / st.baseline) * 100) : 0,
      changeFromNadirPct: st.nadir ? Math.round(((sum - st.nadir) / st.nadir) * 100) : 0,
      response,
    });
    if (sum < st.nadir) st.nadir = sum;
    state.set(group, st);
  }
  return out;
}

const RESPONSE_CODES = ['baseline', 'CR', 'PR', 'SD', 'PD', 'NA'];
/** A response in words (locales/<language>/imaging.json); an unknown value stays as it is. */
export const responseLabel = (code, language) => (has(language, `imaging.responseLabel.${code}`) ? t(language, `imaging.responseLabel.${code}`) : code);
/** Every response in words: { PR: 'частичный ответ', … }. */
export const responseLabels = (language) => Object.fromEntries(RESPONSE_CODES.map((c) => [c, responseLabel(c, language)]));
