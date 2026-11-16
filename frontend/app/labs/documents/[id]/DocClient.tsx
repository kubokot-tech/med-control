'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import Icon from '../../../ui/icons';
import AiComment from '../../../ui/AiComment';
import { apiFetch } from '../../../ui/labUtils';
import { apiJson, errorRu } from '../../../ui/api';
import { useFormat } from '../../../ui/format';

type Document = {
  id: string;
  created_at: string;
  sha256: string;
  filename: string | null;
  lab_name: string | null;
  doc_date: string | null;
  file_url: string | null;
  mime_type: string | null;
  source?: string | null;
};

type Obs = {
  test_name_raw: string;
  result_text: string | null;
  result_num: number | null;
  unit_raw: string | null;
  ref_text_raw: string | null;
  ref_low: number | null;
  ref_high: number | null;
};

type Resp = { document: Document; observations: Obs[] };

function Inner() {
  const f = useFormat();
  const t = useTranslations('labs');
  const params = useParams();
  const id = params?.id?.toString();
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      setData(await apiJson<Resp>(`/api/gateway/labs/documents/${id}`));
    } catch (e: any) {
      setErr(errorRu(e));
    }
  }

  async function download(sha256: string) {
    const r = await apiFetch(`/api/gateway/attachments/${sha256}`);
    if (!r.ok) {
      alert(t('doc.downloadFailed', { error: errorRu(await r.json().catch(() => ({})), `HTTP ${r.status}`) }));
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sha256}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const d = data?.document;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="series-head">
        <a href="/labs/documents" className="series-head__back" aria-label={t('doc.back')}><Icon name="back" /></a>
        <div style={{ minWidth: 0 }}>
          <div className="series-head__title" style={{ fontSize: 22 }}>{d?.lab_name || t('doc.untitled')}</div>
          <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{d?.doc_date || d?.created_at ? f.date(d.doc_date || d.created_at) : ''}{d?.filename ? ` · ${d.filename}` : ''}</div>
        </div>
        {d && d.mime_type && <button className="btn btn--secondary btn--sm" style={{ marginLeft: 'auto' }} onClick={() => download(d.sha256)}><Icon name="download" />PDF</button>}
        {d && d.source === 'manual' && <span className="pill" style={{ marginLeft: 'auto' }}>{t('doc.manual')}</span>}
      </div>
      {err && <div style={{ color: 'var(--hi-fg)', background: 'var(--hi-bg)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{t('doc.error', { error: err })}</div>}

      {data && <AiComment subjectType="lab_document" subjectId={data.document.id} />}

      {data && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                {(['test', 'value', 'unit', 'ref'] as const).map((h) => (
                  <th key={h}>{t(`doc.table.${h}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.observations.map((o, i) => {
                const val = o.result_text ?? (o.result_num != null ? String(o.result_num) : '—');
                const ref = o.ref_text_raw ?? (o.ref_low != null && o.ref_high != null ? `${o.ref_low}–${o.ref_high}` : '—');
                return (
                  <tr key={i}>
                    <td>{o.test_name_raw}</td>
                    <td><b>{val}</b></td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{o.unit_raw || '—'}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{ref}</td>
                  </tr>
                );
              })}
              {!data.observations.length && <tr><td colSpan={4} className="muted">{t('doc.noData')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Loading() {
  const t = useTranslations('labs');
  return <div style={{ padding: 16 }}>{t('loading')}</div>;
}

export default function DocClient() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
