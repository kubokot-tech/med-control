'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import Icon from './icons';
import { apiFetch } from './labUtils';
import AiAsk from './AiAsk';
import AiContext from './AiContext';
import { errorRu } from './api';
import { useFormat } from './format';

type Review = { id: string; model: string | null; text: string; created_at: string; context?: string | null } | null;
type Month = { ym: string; title: string; results: number; review: Review };

/** Monthly AI review of all labs: pick a month, read or request the review. */
export default function MonthReviewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const f = useFormat();
  const t = useTranslations('labs');
  const [months, setMonths] = useState<Month[] | null>(null);
  const [ym, setYm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([apiFetch('/api/gateway/ai/labs-month'), apiFetch('/api/gateway/ai/status')]);
    if (r.ok) {
      const j = await r.json();
      setMonths(j.months);
      setYm((cur) => cur && j.months.some((m: Month) => m.ym === cur) ? cur : j.months[0]?.ym || null);
    }
    if (s.ok) setEnabled(Boolean((await s.json()).enabled));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  async function run() {
    if (!ym) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/ai/labs-month/${ym}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      await load();
    } catch (e: any) { setErr(t('monthReview.failed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }

  const m = months?.find((x) => x.ym === ym) || null;
  const when = m?.review ? f.date(m.review.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <BottomSheet open={open} onClose={onClose} title={t('monthReview.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t('monthReview.desc')}
        </div>
        {months && months.length === 0 && <div className="muted">{t('monthReview.empty')}</div>}
        {months && months.length > 0 && (
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {months.slice(0, 8).map((x) => (
              <button key={x.ym} type="button" className={`seg__btn ${x.ym === ym ? 'seg__btn--active' : ''}`} onClick={() => setYm(x.ym)}>
                {x.title}{x.review ? ' ✓' : ''}
              </button>
            ))}
          </div>
        )}
        {m && <div className="muted" style={{ fontSize: 13 }}>{!m.review ? t('monthReview.results', { n: m.results, month: m.title }) : m.review.model ? t('monthReview.resultsReviewedModel', { n: m.results, month: m.title, when, model: m.review.model }) : t('monthReview.resultsReviewed', { n: m.results, month: m.title, when })}</div>}
        {err && <div className="msg msg--error">{err}</div>}
        {busy && <div className="muted" style={{ fontSize: 14 }}>{t('monthReview.busy')}</div>}
        {m?.review && !busy && <div className="ai-comment__text">{m.review.text}</div>}
        {m?.review && !busy && <AiContext context={m.review.context} />}
        {m?.review && !busy && <AiAsk subjectType="labs_month" subjectId={m.ym} enabled={enabled} />}
        {m && (
          <button type="button" className={`btn ${m.review ? 'btn--secondary' : 'btn--primary'}`} onClick={run} disabled={busy || !enabled} title={enabled ? '' : t('monthReview.noKey')}>
            <Icon name="refresh" />{m.review ? t('monthReview.again') : t('monthReview.run', { month: m.title })}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
