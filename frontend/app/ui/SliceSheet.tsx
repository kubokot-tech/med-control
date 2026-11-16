'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import Icon from './icons';
import { apiFetch } from './labUtils';
import { errorRu } from './api';

type Series = { id: string; number: number | null; description: string; modality: string; count: number; bodyPart: string };
// window presets sent to the gateway; labels: imaging.slice.windows.<key>
const WINDOWS = ['auto', 'lung', 'soft', 'bone', 'brain'] as const;

/**
 * Pick a slice of an imported study (series, position, window) and attach it to the study as a PNG.
 * The picture then shows on the card and is seen by the AI in questions and comments.
 */
export default function SliceSheet({ open, onClose, studyId, title, onSaved }: { open: boolean; onClose: () => void; studyId: string; title: string; onSaved: () => void }) {
  const t = useTranslations('imaging.slice');
  const [series, setSeries] = useState<Series[]>([]);
  const [sid, setSid] = useState<string>('');
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [win, setWin] = useState('auto');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ text: string; index: number } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [hint, setHint] = useState(false);
  const timer = useRef<number | null>(null);
  const lastUrl = useRef<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setErr(null); setMsg(null);
    apiFetch(`/api/gateway/imaging/studies/${studyId}/series`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setSeries(j.series);
      const first = j.series.slice().sort((a: Series, b: Series) => b.count - a.count)[0];
      if (first) { setSid(first.id); setTotal(first.count); setIndex(Math.floor(first.count / 2)); }
    }).catch((e) => setErr(String(e?.message || e)));
  }, [open, studyId]);

  const loadPreview = useCallback(async () => {
    if (!sid) return;
    const seq = ++reqSeq.current;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/gateway/imaging/studies/${studyId}/slice?series=${sid}&index=${index}&window=${win}&width=700`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'render');
      const count = Number(r.headers.get('x-slice-total') || 0); if (count) setTotal(count);
      const blob = await r.blob();
      if (seq !== reqSeq.current) return; // a newer slice was requested meanwhile
      const u = URL.createObjectURL(blob);
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = u; setUrl(u); setErr(null);
    } catch (e: any) { setErr(t('loadFailed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }, [studyId, sid, index, win, t]);

  useEffect(() => {
    if (!open || !sid) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(loadPreview, 150);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [open, sid, index, win, loadPreview]);

  function pickSeries(id: string) {
    const s = series.find((x) => x.id === id); if (!s) return;
    setSid(id); setTotal(s.count); setIndex(Math.floor(s.count / 2));
  }
  async function ask() {
    setExplaining(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/imaging/studies/${studyId}/slice/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: sid, index, window: win }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setExplain({ text: j.text, index: j.index });
    } catch (e: any) { setErr(t('explainFailed', { error: String(e?.message || e) })); } finally { setExplaining(false); }
  }
  async function save() {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch(`/api/gateway/imaging/studies/${studyId}/slices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: sid, index, window: win, label }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setMsg(t('saved', { n: j.index + 1, total: j.total, filename: j.attachment.filename }));
      onSaved();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setSaving(false); }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('title', { title })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {series.length > 1 && (
          <label className="field"><span>{t('series')}</span>
            <select value={sid} onChange={(e) => pickSeries(e.target.value)}>
              {series.map((s) => <option key={s.id} value={s.id}>{[s.number != null ? t('seriesNumber', { n: s.number }) : '', s.modality, s.description || s.bodyPart, t('seriesCount', { n: s.count })].filter(Boolean).join(' · ')}</option>)}
            </select>
          </label>
        )}
        <div className="seg" style={{ flexWrap: 'wrap' }}>{WINDOWS.map((k) => <button key={k} type="button" className={`seg__btn ${win === k ? 'seg__btn--active' : ''}`} onClick={() => setWin(k)}>{t(`windows.${k}`)}</button>)}</div>
        <div className="slice-preview">
          {url ? <img src={url} alt={t('alt', { n: index + 1 })} /> : <div className="muted" style={{ padding: 40, textAlign: 'center' }}>{err ? '' : t('loading')}</div>}
          {busy && <div className="slice-preview__busy" />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index <= 0} aria-label={t('prev')}><Icon name="back" /></button>
          <input type="range" min={0} max={Math.max(0, total - 1)} value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{ flex: 1 }} />
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setIndex((i) => Math.min(total - 1, i + 1))} disabled={index >= total - 1} aria-label={t('next')}><Icon name="chevron" /></button>
          <span className="muted" style={{ fontSize: 13, minWidth: 80, textAlign: 'right' }}>{total ? `${index + 1} / ${total}` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--soft btn--sm" onClick={ask} disabled={explaining || !url}><Icon name="info" size={18} />{explaining ? t('explaining') : t('explain')}</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHint(!hint)}>{t('howToRead')}</button>
        </div>
        {hint && (
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            {t('hint')}
          </div>
        )}
        {explain && explain.index === index && <div className="ai-comment__text" style={{ fontSize: 14, background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px' }}>{explain.text}</div>}
        <label className="field"><span>{t('label')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} maxLength={40} /></label>
        {err && <div className="msg msg--error">{err}</div>}
        {msg && <div className="msg msg--ok">{msg}</div>}
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={saving || !sid || !url}><Icon name="check" strokeWidth={2.2} />{saving ? t('saving') : t('save')}</button>
        <div className="muted" style={{ fontSize: 13 }}>{t('note')}</div>
      </div>
    </BottomSheet>
  );
}
