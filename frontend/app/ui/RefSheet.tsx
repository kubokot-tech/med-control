'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import { apiJson, errorRu } from './api';
import { useFormat } from './format';
import { refText } from './labUtils';

type Range = { low: number | null; high: number | null };
export type RefItem = {
  key: string; name: string; short: string | null; unit: string | null; category: string;
  builtIn: { any: Range | null; m: Range | null; f: Range | null } | null;
  inForce: Range & { source: 'user' | 'catalog' | 'lab' };
  override: { mode: 'custom' | 'lab'; low: number | null; high: number | null } | null;
};
export type RefSettings = { sex: 'm' | 'f' | null; items: RefItem[] };

/** Where a built-in range comes from: a message key of labs.refSheet.note (with the sex for 'forSex'). */
export type BuiltInNote = { key: 'notInCatalog' | 'forSex' | 'anySex' | 'bySex'; sex?: 'm' | 'f' };

/** The built-in range that applies for this sex, and a few words on where it comes from. */
export function builtInFor(item: RefItem, sex: RefSettings['sex']): { range: Range | null; note: BuiltInNote | null } {
  const b = item.builtIn;
  if (!b) return { range: null, note: { key: 'notInCatalog' } };
  if (sex && b[sex]) return { range: b[sex], note: { key: 'forSex', sex } };
  if (b.any) return { range: b.any, note: b.m || b.f ? { key: 'anySex' } : null };
  return { range: null, note: { key: 'bySex' } };
}

/**
 * Where the range of one marker comes from (docs/REFERENCE-RANGES.md): the built-in one, the lab's printed one, or the
 * user's own. Values are in the marker's catalog unit.
 */
export default function RefSheet({ open, onClose, testKey, onSaved }: { open: boolean; onClose: () => void; testKey: string; onSaved?: () => void }) {
  const f = useFormat();
  const t = useTranslations('labs');
  const [data, setData] = useState<RefSettings | null>(null);
  const [mode, setMode] = useState<'default' | 'lab' | 'custom'>('default');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    apiJson<RefSettings>('/api/gateway/labs/refs').then((d) => {
      setData(d);
      const it = d.items.find((x) => x.key === testKey);
      setMode(it?.override?.mode === 'custom' ? 'custom' : it?.override?.mode === 'lab' ? 'lab' : 'default');
      setLow(it?.override?.low != null ? f.numText(String(it.override.low)) || '' : '');
      setHigh(it?.override?.high != null ? f.numText(String(it.override.high)) || '' : '');
    }).catch((e) => setErr(errorRu(e)));
  }, [open, testKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = data?.items.find((x) => x.key === testKey) || null;
  const built = item && data ? builtInFor(item, data.sex) : null;
  const note = built?.note ? t(`refSheet.note.${built.note.key}`, { sex: built.note.sex || '' }) : '';
  const unit = item?.unit ? ` ${item.unit}` : '';
  const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  async function save() {
    setBusy(true); setErr(null);
    try {
      const path = `/api/gateway/labs/refs/${encodeURIComponent(testKey)}`;
      if (mode === 'default') await apiJson(path, { method: 'DELETE' });
      else await apiJson(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'lab' ? { mode: 'lab' } : { mode: 'custom', low: toNum(low), high: toNum(high) }) });
      onSaved?.();
      onClose();
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  const option = (value: typeof mode, title: string, sub: React.ReactNode) => (
    <label className="choice-row">
      <input type="radio" name="ref-mode" checked={mode === value} onChange={() => setMode(value)} />
      <span><b>{title}</b><br /><span className="muted" style={{ fontSize: 13 }}>{sub}</span></span>
    </label>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={t('refSheet.title', { name: item?.short || testKey })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t('refSheet.desc')}
        </div>
        {item && built && (
          <div className="sheet__list">
            {option('default', t('refSheet.catalog'), built.range ? `${refText(f, built.range.low, built.range.high)}${unit}${note ? ` · ${note}` : ''}` : note)}
            {option('lab', t('refSheet.lab'), t('refSheet.labHint'))}
            {option('custom', t('refSheet.custom'), (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                {t.rich('refSheet.customRange', {
                  low: () => <input inputMode="decimal" value={low} onChange={(e) => { setLow(e.target.value); setMode('custom'); }} style={{ width: 80 }} aria-label={t('refSheet.low')} />,
                  high: () => <input inputMode="decimal" value={high} onChange={(e) => { setHigh(e.target.value); setMode('custom'); }} style={{ width: 80 }} aria-label={t('refSheet.high')} />,
                })}
                {item.unit || ''}
                <span style={{ flexBasis: '100%' }}>{t('refSheet.customHint')}</span>
              </span>
            ))}
          </div>
        )}
        {err && <div className="msg msg--error">{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn--primary" disabled={busy || !item} onClick={save}>{t('refSheet.save')}</button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t('refSheet.cancel')}</button>
        </div>
      </div>
    </BottomSheet>
  );
}
