'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from '../../ui/icons';
import { apiFetch } from '../../ui/labUtils';
import { useFormat } from '../../ui/format';
import EmptyState from '../../ui/EmptyState';
import { labDocumentHref } from '../../ui/recordLink';

type Doc = {
  id: string;
  created_at: string;
  sha256: string;
  filename: string | null;
  lab_name: string | null;
  doc_date: string | null;
  obs_count?: number;
  has_ai_comment?: boolean;
};

export default function DocumentsPage() {
  const f = useFormat();
  const t = useTranslations('labs');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/gateway/labs/documents')
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        setDocs(((await r.json()).documents || []) as Doc[]);
      })
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  return (
    <div className="doc-list">
      {err && <div className="msg msg--error">{err}</div>}
      {!docs && !err && <div className="skeleton" style={{ height: 76 }} />}
      {docs?.length === 0 && (
        <EmptyState icon="labs" title={t('documents.emptyTitle')} description={t('documents.emptyDesc')} action={<Link href="/labs/upload" className="btn btn--primary"><Icon name="upload" />{t('documents.upload')}</Link>} />
      )}
      {docs?.map((d) => (
        <Link key={d.id} href={labDocumentHref(d.id)} className="event-card">
          <div className="event-card__icon event-card__icon--labs"><Icon name="doc" size={22} /></div>
          <div className="event-card__body">
            <div className="event-card__title">{d.lab_name || t('documents.untitled')}</div>
            <div className="event-card__sub">
              {f.date(d.doc_date || d.created_at)}
              {d.obs_count != null ? ` · ${t('documents.markers', { n: Number(d.obs_count) })}` : ''}
              {d.filename ? ` · ${d.filename}` : ''}
            </div>
            {d.has_ai_comment && <span className="pill ok" style={{ marginTop: 6 }}>{t('documents.aiComment')}</span>}
          </div>
          <Icon name="chevron" size={20} className="event-card__chevron" />
        </Link>
      ))}
    </div>
  );
}
