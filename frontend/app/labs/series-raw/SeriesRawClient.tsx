'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import SeriesView from '../../ui/SeriesView';
import { apiFetch } from '../../ui/labUtils';

type Point = {
  date: string; valueNum: number | null; valueText: string | null;
  unit: string | null; refLow: number | null; refHigh: number | null;
  delta: number | null; test?: string | null; documentId?: string | null;
};
type Resp = { test: string; canonicalKey?: string | null; last: Point | null; points: Point[] };

function Inner() {
  const t = useTranslations('labs');
  const sp = useSearchParams();
  const test = sp.get('test') || '';
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!test) return;
    setErr(null);
    apiFetch(`/api/gateway/labs/series-raw?test=${encodeURIComponent(test)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        setData(await r.json());
      })
      .catch((e) => setErr(String(e?.message || e)));
  }, [test]);

  if (!test) {
    return (
      <div className="msg msg--error">{t('series.noTest')}</div>
    );
  }

  return (
    <SeriesView
      title={test}
      testKey={data?.canonicalKey ?? null}
      last={data?.last || null}
      points={data?.points || []}
      error={err}
    />
  );
}

function Loading() {
  const t = useTranslations('labs');
  return <div style={{ padding: 16 }}>{t('loading')}</div>;
}

export default function SeriesRawClient() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
