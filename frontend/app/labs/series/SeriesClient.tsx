'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import SeriesView from '../../ui/SeriesView';
import { apiFetch } from '../../ui/labUtils';

type Point = {
  date: string; valueNum: number | null; valueText: string | null;
  unit: string | null; refLow: number | null; refHigh: number | null; refSource?: string | null;
  delta: number | null; test?: string | null; documentId?: string | null;
};
type Resp = { key: string; name?: string; short?: string; units?: string[]; mixedUnits?: boolean; last: Point | null; points: Point[] };

function Inner() {
  const t = useTranslations('labs');
  const sp = useSearchParams();
  const key = (sp.get('key') || 'ALT').toUpperCase();
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setErr(null);
    apiFetch(`/api/gateway/labs/series?key=${encodeURIComponent(key)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        setData(await r.json());
      })
      .catch((e) => setErr(String(e?.message || e)));
  }, [key, reload]);

  return (
    <SeriesView
      title={data?.short || key}
      subtitle={data?.name || null}
      testKey={key}
      last={data?.last || null}
      points={data?.points || []}
      error={err}
      onRefsChanged={() => setReload((n) => n + 1)}
      warning={data?.mixedUnits ? t('series.mixedUnits', { units: (data.units || []).join(', ') }) : null}
    />
  );
}

function Loading() {
  const t = useTranslations('labs');
  return <div style={{ padding: 16 }}>{t('loading')}</div>;
}

export default function SeriesClient() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
