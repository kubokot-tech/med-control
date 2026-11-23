'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import Icon, { type IconName } from '../ui/icons';
import { apiFetch } from '../ui/labUtils';
import { errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import { staticDetailHref } from '../ui/recordLink';

type Hit = { kind: string; id: string; title: string; snippet: string; date: string | null; rank: number; href: string };
type Kind = 'marker' | 'note' | 'milestone' | 'document' | 'imaging' | 'appointment' | 'contact' | 'symptom' | 'infusion' | 'ai' | 'labdoc' | 'medication';
// group label: search.kinds.<kind>
const KIND: Record<Kind, { icon: IconName }> = {
  marker: { icon: 'labs' }, note: { icon: 'doc' }, milestone: { icon: 'doc' }, document: { icon: 'doc' },
  imaging: { icon: 'imaging' }, appointment: { icon: 'consult' }, contact: { icon: 'user' }, symptom: { icon: 'symptoms' }, infusion: { icon: 'drip' },
  ai: { icon: 'info' }, labdoc: { icon: 'labs' }, medication: { icon: 'meds' },
};
const ORDER: Kind[] = ['contact', 'marker', 'medication', 'milestone', 'document', 'note', 'imaging', 'labdoc', 'appointment', 'symptom', 'infusion', 'ai'];

function Snippet({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  return <span>{parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="search-mark">{p}</mark> : <span key={i}>{p}</span>))}</span>;
}

function SearchInner() {
  const t = useTranslations('search');
  const f = useFormat();
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get('q') || '');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setHits(null); return; }
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const r = await apiFetch(`/api/gateway/search?q=${encodeURIComponent(query)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(errorRu(j));
        setHits(j.results);
        router.replace(`/search?q=${encodeURIComponent(query)}`);
      } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, router]);

  const groups = new Map<string, Hit[]>();
  for (const h of hits || []) { if (!groups.has(h.kind)) groups.set(h.kind, []); groups.get(h.kind)!.push(h); }
  const fmtDate = (d: string | null) => (d ? f.date(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <input ref={ref} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('placeholder')} style={{ fontSize: 17 }} />
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}
      {busy && <div className="muted" style={{ marginBottom: 12 }}>{t('busy')}</div>}
      {hits && hits.length === 0 && !busy && <div className="card coming-soon"><div className="coming-soon__title">{t('emptyTitle')}</div><div className="coming-soon__desc">{t('emptyDesc')}</div></div>}
      {ORDER.filter((k) => groups.has(k)).map((k) => (
        <div key={k} style={{ marginBottom: 18 }}>
          <div className="section-label">{t(`kinds.${k}`)} · {groups.get(k)!.length}</div>
          <div className="today-section">
            {groups.get(k)!.map((h) => (
              <Link key={`${h.kind}-${h.id}`} href={staticDetailHref(h.href)} className="event-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="event-card__icon event-card__icon--other"><Icon name={KIND[k].icon} size={22} /></div>
                <div className="event-card__body" style={{ minWidth: 0 }}>
                  <div className="event-card__title">{h.title}{h.date ? <span className="muted" style={{ fontWeight: 400 }}> · {fmtDate(h.date)}</span> : null}</div>
                  {h.snippet && <div className="event-card__sub" style={{ whiteSpace: 'normal' }}><Snippet text={h.snippet} /></div>}
                </div>
                <Icon name="chevron" size={20} className="event-card__chevron" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<div className="page-container"><div className="skeleton" style={{ height: 120 }} /></div>}><SearchInner /></Suspense>;
}
