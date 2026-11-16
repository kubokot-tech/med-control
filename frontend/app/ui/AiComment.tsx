'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiFetch } from './labUtils';
import AiAsk from './AiAsk';
import AiContext from './AiContext';
import { errorRu } from './api';
import { useFormat } from './format';

type Comment = { id: string; model: string | null; text: string; created_at: string; context?: string | null };
type Subject = 'lab_document' | 'imaging_study' | 'note';
const PATH: Record<Subject, string> = { lab_document: 'lab-document', imaging_study: 'imaging-study', note: 'note' };

/**
 * AI commentary on one record (lab document or imaging study) plus the follow-up thread.
 * compact: collapsed by default with a one-line summary, for cards in a list.
 */
export default function AiComment({ subjectType = 'lab_document', subjectId, compact = false }: { subjectType?: Subject; subjectId: string; compact?: boolean }) {
  const t = useTranslations('ai');
  const f = useFormat();
  const [c, setC] = useState<Comment | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(!compact);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([apiFetch(`/api/gateway/ai/comments/${PATH[subjectType]}/${subjectId}`), apiFetch('/api/gateway/ai/status')]);
    if (r.ok) setC((await r.json()).comment);
    if (s.ok) setEnabled(Boolean((await s.json()).enabled));
  }, [subjectType, subjectId]);
  useEffect(() => { load(); }, [load]);

  async function ask() {
    setBusy(true); setErr(null); setOpen(true);
    try {
      const r = await apiFetch(`/api/gateway/ai/comments/${PATH[subjectType]}/${subjectId}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setC(j.comment);
    } catch (e: any) { setErr(t('failed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }

  const when = c ? f.date(c.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const body = (
    <>
      {c === null && !busy && <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t(`comment.intro.${subjectType}`)}</div>}
      {c && !busy && <div className="ai-comment__text">{c.text}</div>}
      {c && !busy && <AiContext context={c.context} />}
      {busy && <div className="muted" style={{ fontSize: 14 }}>{t('comment.thinking')}</div>}
      {err && <div className="msg msg--error">{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={`btn btn--sm ${c ? 'btn--secondary' : 'btn--primary'}`} onClick={ask} disabled={busy || !enabled} title={enabled ? '' : t('noKey')}>
          <Icon name="refresh" />{c ? t('comment.askAgain') : t('comment.send')}
        </button>
      </div>
      {c && <AiAsk subjectType={subjectType} subjectId={subjectId} enabled={enabled} />}
    </>
  );

  if (compact) {
    return (
      <div className="ai-comment ai-comment--compact">
        <button type="button" className="ai-comment__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="info" size={18} />
          <span style={{ flex: 1, textAlign: 'left' }}>{c ? t('comment.titleAt', { when }) : c === null ? t('comment.titleNone') : t('comment.title')}</span>
          <Icon name="chevron" size={18} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>{body}</div>}
      </div>
    );
  }
  return (
    <div className="card meds-card ai-comment">
      <div className="meds-card__row">
        <div className="card__title">{t('comment.title')}</div>
        {c && <span className="muted" style={{ fontSize: 13 }}>{when}{c.model ? ` · ${c.model}` : ''}</span>}
      </div>
      {body}
    </div>
  );
}
