'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiJson, errorRu, todayKey } from './api';
import type { RefSettings } from './RefSheet';
import { labDocumentHref } from './recordLink';

type Row = { key: string; name: string; value: string; unit: string; refLow: string; refHigh: string };
const OTHER = '__other';
const emptyRow = (): Row => ({ key: '', name: '', value: '', unit: '', refLow: '', refHigh: '' });
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

/**
 * Labs → Upload → "Enter manually": results from a paper report or a lab without a parser, without AI.
 * Markers come from the catalog (unit prefilled in the user's units) or by a free name; the value as written
 * ("5,5", "<0,6", "negative"). Saved like a parsed report: units, ranges, alerts, the feed.
 */
export default function ManualLabEntry() {
  const t = useTranslations('labs');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RefSettings['items']>([]);
  const [date, setDate] = useState(todayKey());
  const [lab, setLab] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; n: number; flagged: number } | null>(null);

  useEffect(() => { if (open && !items.length) apiJson<RefSettings>('/api/gateway/labs/refs').then((r) => setItems(r.items)).catch(() => {}); }, [open, items.length]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const groups = useMemo(() => (['blood', 'urine'] as const).map((c) => [c, items.filter((i) => i.category === c)] as const), [items]);

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pick = (i: number, key: string) => set(i, key === OTHER ? { key: OTHER, unit: '' } : { key, name: '', unit: byKey.get(key)?.unit || '' });
  const filled = rows.filter((r) => r.value.trim() && (r.key && r.key !== OTHER ? true : r.name.trim()));

  async function save() {
    setBusy(true); setErr(null); setDone(null);
    try {
      const body = {
        date, labName: lab.trim() || null,
        rows: filled.map((r) => ({ key: r.key && r.key !== OTHER ? r.key : null, name: r.key === OTHER ? r.name.trim() : null, value: r.value.trim(), unit: r.unit.trim() || null, refLow: num(r.refLow), refHigh: num(r.refHigh) })),
      };
      const j = await apiJson<{ documentId: string; inserted: number; flagged: unknown[] }>('/api/gateway/labs/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setDone({ id: j.documentId, n: j.inserted, flagged: j.flagged.length });
      setRows([emptyRow(), emptyRow(), emptyRow()]); setLab('');
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className="card meds-card" style={{ marginTop: 16 }}>
        <div className="meds-card__row">
          <div><div className="card__title">{t('manual.title')}</div><div className="muted" style={{ fontSize: 14 }}>{t('manual.desc')}</div></div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}><Icon name="plus" size={18} />{t('manual.open')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card meds-card" style={{ marginTop: 16 }}>
      <div className="meds-card__row">
        <div className="card__title">{t('manual.title')}</div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>{t('manual.collapse')}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '0 1 170px' }}><span>{t('manual.date')}</span><input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" style={{ flex: '1 1 220px' }}><span>{t('manual.lab')}</span><input value={lab} onChange={(e) => setLab(e.target.value)} maxLength={120} placeholder={t('manual.labPlaceholder')} /></label>
      </div>
      <div className="manual-rows">
        {rows.map((r, i) => {
          const it = r.key && r.key !== OTHER ? byKey.get(r.key) : undefined;
          return (
            <div key={i} className="manual-row">
              <select value={r.key} onChange={(e) => pick(i, e.target.value)} aria-label={t('manual.marker')} style={{ height: 36 }}>
                <option value="">{t('manual.markerPick')}</option>
                {groups.map(([c, list]) => <optgroup key={c} label={t(`manual.category.${c}`)}>{list.map((x) => <option key={x.key} value={x.key}>{x.short && x.short !== x.name ? `${x.short} — ${x.name}` : x.name}</option>)}</optgroup>)}
                <option value={OTHER}>{t('manual.otherMarker')}</option>
              </select>
              {r.key === OTHER && <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={t('manual.namePlaceholder')} maxLength={120} aria-label={t('manual.name')} />}
              <input value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={t('manual.valuePlaceholder')} inputMode="decimal" maxLength={40} aria-label={t('manual.value')} className="manual-row__value" />
              <input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} placeholder={it?.unit || t('manual.unitPlaceholder')} maxLength={20} aria-label={t('manual.unit')} className="manual-row__unit" />
              <details className="manual-row__ref">
                <summary className="muted">{t('manual.range')}</summary>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input value={r.refLow} onChange={(e) => set(i, { refLow: e.target.value })} placeholder={t('manual.rangeLowPlaceholder')} inputMode="decimal" aria-label={t('manual.rangeLow')} />
                  <input value={r.refHigh} onChange={(e) => set(i, { refHigh: e.target.value })} placeholder={t('manual.rangeHighPlaceholder')} inputMode="decimal" aria-label={t('manual.rangeHigh')} />
                </span>
              </details>
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {t('manual.hint')}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRows([...rows, emptyRow()])} disabled={rows.length >= 80}><Icon name="plus" size={18} />{t('manual.addRow')}</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy || !filled.length || !date}>{busy ? t('manual.saving') : filled.length ? t('manual.saveN', { n: filled.length }) : t('manual.save')}</button>
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      {done && <div className="msg msg--ok">{t.rich(done.flagged ? 'manual.savedFlagged' : 'manual.saved', {
        n: done.n,
        flagged: done.flagged,
        open: (c) => <Link href={labDocumentHref(done.id)}>{c}</Link>,
        summary: (c) => <Link href="/labs/summary?cat=blood">{c}</Link>,
      })}</div>}
    </div>
  );
}
