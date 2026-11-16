'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiFetch } from './labUtils';
import AiContext from './AiContext';
import { errorRu } from './api';
import Markdown from './Markdown';
import { useFormat } from './format';

type Q = { id: string; question: string; answer: string; model: string | null; created_at: string; context?: string | null };

/** Follow-up questions to the AI about one record; the thread is stored and shown in order. */
export default function AiAsk({ subjectType, subjectId, enabled = true, compact = false, extra, placeholder, markdown = false, hideBar = false, onAsked }: { subjectType: 'lab_document' | 'labs_month' | 'imaging_study' | 'infusions' | 'note' | 'chat'; subjectId: string; enabled?: boolean; compact?: boolean; extra?: () => Record<string, unknown>; placeholder?: string; markdown?: boolean; hideBar?: boolean; onAsked?: () => void }) {
  const t = useTranslations('ai');
  const f = useFormat();
  const [items, setItems] = useState<Q[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem(`dtc_aiask_${subjectType}_${subjectId}`) !== 'collapsed'; } catch { return true; } });
  const toggleExpanded = () => { const v = !expanded; setExpanded(v); try { localStorage.setItem(`dtc_aiask_${subjectType}_${subjectId}`, v ? 'open' : 'collapsed'); } catch { /* ignore */ } };
  async function removeOne(id: string) {
    const r = await apiFetch(`/api/gateway/ai/questions/${id}`, { method: 'DELETE' });
    if (r.ok) setItems((xs) => xs.filter((x) => x.id !== id)); else setErr(errorRu(await r.json().catch(() => ({}))));
  }
  async function clearAll() {
    if (!confirm(t('ask.confirmClear', { n: items.length }))) return;
    const r = await apiFetch(`/api/gateway/ai/questions?subject_type=${subjectType}&subject_id=${encodeURIComponent(subjectId)}`, { method: 'DELETE' });
    if (r.ok) setItems([]); else setErr(errorRu(await r.json().catch(() => ({}))));
  }

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/gateway/ai/questions?subject_type=${subjectType}&subject_id=${encodeURIComponent(subjectId)}`);
    if (r.ok) setItems((await r.json()).questions || []);
  }, [subjectType, subjectId]);
  useEffect(() => { load(); }, [load]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId, question, ...(extra ? extra() : {}) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setItems((xs) => [...xs, j.question]);
      setQ('');
      onAsked?.();
    } catch (e: any) { setErr(t('failed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }

  const when = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (compact && !open && items.length === 0) {
    return <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)} disabled={!enabled} title={enabled ? '' : t('noKey')}><Icon name="info" size={18} />{t('ask.open')}</button>;
  }
  return (
    <div className="ai-ask">
      {items.length > 0 && !hideBar && (
        <div className="ai-ask__bar">
          <button type="button" className="ai-ask__toggle" onClick={toggleExpanded} aria-expanded={expanded}>
            <Icon name="chevron" size={16} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
            {!expanded && items.length ? t('ask.dialogLast', { n: items.length, when: when(items[items.length - 1].created_at) }) : t('ask.dialog', { n: items.length })}
          </button>
          {expanded && <button type="button" className="btn btn--ghost btn--sm" onClick={clearAll}>{t('ask.clear')}</button>}
        </div>
      )}
      {items.length > 0 && (expanded || hideBar) && (
        <div className="ai-ask__list">
          {items.map((x) => (
            <div key={x.id} className="ai-ask__item">
              <div className="ai-ask__q"><span className="muted" style={{ fontSize: 12 }}>{when(x.created_at)}</span><br />{x.question}</div>
              <div className="ai-ask__a ai-comment__text">{markdown ? <Markdown text={x.answer} /> : x.answer}<AiContext context={x.context} /></div>
              <button type="button" className="ai-ask__del" onClick={() => removeOne(x.id)} aria-label={t('ask.deleteOne')}><Icon name="close" size={14} />{t('ask.delete')}</button>
            </div>
          ))}
        </div>
      )}
      {err && <div className="msg msg--error">{err}</div>}
      <form onSubmit={ask} className="ai-ask__form">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || t('ask.placeholder')} maxLength={2000} disabled={busy || !enabled} />
        <button type="submit" className="btn btn--secondary btn--sm" disabled={busy || !enabled || !q.trim()}>{busy ? t('ask.thinking') : t('ask.submit')}</button>
      </form>
    </div>
  );
}
