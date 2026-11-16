'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiFetch } from './labUtils';
import { errorRu } from './api';

export type DraftObs = { test_name_raw: string; result_text?: string | null; result_num?: number | null; unit_raw?: string | null; ref_text_raw?: string | null; ref_low?: number | null; ref_high?: number | null; category?: string; _lo?: string; _hi?: string };
export type Draft = { lab_name: string | null; doc_date: string | null; observations: DraftObs[]; warnings?: string[]; model?: string | null };

const num = (s: string) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; };

/** Review of an AI-parsed lab document: edit rows, then save or discard. Nothing is stored until save. */
export default function LabsReviewPanel({ sha256, draft, onSaved, onDiscard }: { sha256: string; draft: Draft; onSaved: (r: { inserted: number; labName?: string | null; docDate?: string | null }) => void; onDiscard: () => void }) {
  const t = useTranslations('labs');
  const [lab, setLab] = useState(draft.lab_name || '');
  const [date, setDate] = useState(draft.doc_date || '');
  const [rows, setRows] = useState<DraftObs[]>(draft.observations);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function patch(i: number, p: Partial<DraftObs>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); }
  function drop(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); }
  const flag = (o: DraftObs) => o.result_num != null && ((o.ref_high != null && o.result_num > o.ref_high) || (o.ref_low != null && o.result_num < o.ref_low));

  async function save() {
    if (!rows.length) { setErr(t('review.noRows')); return; }
    if (!date) { setErr(t('review.noDate')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/labs/commit-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha256, lab_name: lab || null, doc_date: date, observations: rows.map(({ _lo, _hi, ...o }) => o) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      onSaved({ inserted: j.inserted, labName: j.labName, docDate: j.docDate });
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function discard() {
    setBusy(true);
    try { await apiFetch(`/api/gateway/labs/pending/${sha256}`, { method: 'DELETE' }); } finally { setBusy(false); onDiscard(); }
  }

  return (
    <div className="review">
      <div className="msg msg--ok" style={{ marginBottom: 10 }}>{draft.model ? t('review.parsedByModel', { model: draft.model }) : t('review.parsed')}</div>
      {draft.warnings && draft.warnings.length > 0 && <div className="msg msg--error" style={{ marginBottom: 10 }}>{t('review.warnings', { warnings: draft.warnings.join('; ') })}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 10 }}>
        <label className="field"><span>{t('review.lab')}</span><input value={lab} onChange={(e) => setLab(e.target.value)} placeholder={t('review.labPlaceholder')} /></label>
        <label className="field"><span>{t('review.date')}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="review__table">
          <thead><tr><th>{t('review.table.test')}</th><th>{t('review.table.value')}</th><th>{t('review.table.unit')}</th><th>{t('review.table.refLow')}</th><th>{t('review.table.refHigh')}</th><th /></tr></thead>
          <tbody>
            {rows.map((o, i) => (
              <tr key={i} className={flag(o) ? 'review__row--flag' : ''}>
                <td><input value={o.test_name_raw} onChange={(e) => patch(i, { test_name_raw: e.target.value })} /></td>
                <td><input value={o.result_text ?? (o.result_num != null ? String(o.result_num) : '')} onChange={(e) => patch(i, { result_text: e.target.value, result_num: num(e.target.value) })} style={{ width: 90 }} /></td>
                <td><input value={o.unit_raw || ''} onChange={(e) => patch(i, { unit_raw: e.target.value || null })} style={{ width: 90 }} /></td>
                <td><input value={o._lo ?? (o.ref_low ?? '')} onChange={(e) => patch(i, { _lo: e.target.value, ref_low: num(e.target.value) })} style={{ width: 70 }} inputMode="decimal" /></td>
                <td><input value={o._hi ?? (o.ref_high ?? '')} onChange={(e) => patch(i, { _hi: e.target.value, ref_high: num(e.target.value) })} style={{ width: 70 }} inputMode="decimal" /></td>
                <td><button type="button" className="ms-file__x" aria-label={t('review.removeRow')} onClick={() => drop(i)}><Icon name="close" size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <div className="msg msg--error" style={{ marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" className="btn btn--primary" onClick={save} disabled={busy}><Icon name="check" strokeWidth={2.2} />{busy ? t('review.saving') : t('review.save', { n: rows.length })}</button>
        <button type="button" className="btn btn--ghost" onClick={discard} disabled={busy}>{t('review.discard')}</button>
      </div>
    </div>
  );
}
