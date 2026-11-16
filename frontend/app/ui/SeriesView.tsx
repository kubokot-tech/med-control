'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import LabChart from './LabChart';
import BiomarkerSheet from './BiomarkerSheet';
import { BIOMARKER_DB } from './BiomarkerInfo';
import { fmtDelta, flagFor, refText, labValueText, isRefSource } from './labUtils';
import RefSheet from './RefSheet';
import { useFormat } from './format';

type Point = {
  date: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refSource?: string | null;
  delta: number | null;
  test?: string | null;
  documentId?: string | null;
  lab?: string | null;
};

type Period = '1m' | '3m' | '6m' | '12m' | 'all';
// labels: imaging.seriesView.period.<val>
const periods: Period[] = ['1m', '3m', '6m', '12m', 'all'];
function filterByPeriod(points: Point[], period: Period): Point[] {
  if (period === 'all') return points;
  const months = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[period];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return points.filter((p) => new Date(p.date) >= cutoff);
}

export default function SeriesView({
  title,
  subtitle,
  testKey,
  last,
  points,
  error,
  warning = null,
  onRefsChanged,
}: {
  title: string;
  subtitle?: string | null;
  testKey: string | null;
  last: Point | null;
  points: Point[];
  error: string | null;
  warning?: string | null;
  onRefsChanged?: () => void;
}) {
  const t = useTranslations('imaging.seriesView');
  const tl = useTranslations('labs');
  const f = useFormat();
  const fmtNum = (n: number) => f.number(n, { maximumFractionDigits: 4 });
  const [period, setPeriod] = useState<Period>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  const refLow = last?.refLow ?? points?.[0]?.refLow ?? null;
  const refHigh = last?.refHigh ?? points?.[0]?.refHigh ?? null;
  const filteredPoints = useMemo(() => filterByPeriod(points, period), [points, period]);
  const flag = last ? flagFor(last.valueNum, refLow, refHigh) : '';
  const hasInfo = Boolean(testKey && BIOMARKER_DB[testKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="series-head">
        <Link href="/labs/summary?cat=blood" className="series-head__back" aria-label={t('back')}><Icon name="back" /></Link>
        <div style={{ minWidth: 0 }}>
          <div className="series-head__title">{title}</div>
          {subtitle && subtitle !== title && <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{subtitle}</div>}
        </div>
        {hasInfo && (
          <button type="button" className="btn btn--soft btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setSheetOpen(true)}>
            <Icon name="info" size={20} />{t('info')}
          </button>
        )}
      </div>

      {error && <div className="msg msg--error">{t('error', { error })}</div>}
      {warning && <div className="msg msg--error">{warning}</div>}

      {last && (
        <div>
          <div className="series-value">
            <div className={`series-value__num ${flag === 'ok' ? 'series-value__num--ok' : flag ? 'series-value__num--warn' : ''}`}>
              {labValueText(f, last.valueNum, last.valueText)}
            </div>
            <div className="muted">{last.unit || ''} · {f.date(last.date)}</div>
            {flag && <span className={`pill ${flag}`}>{tl(`flag.${flag}`)}</span>}
          </div>
          <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {refText(f, refLow, refHigh) ? t('ref', { range: refText(f, refLow, refHigh) }) : t('refNone')}
            {last.refSource ? ` (${isRefSource(last.refSource) ? tl(`refSource.${last.refSource}`) : last.refSource})` : ''}
            {testKey && onRefsChanged && <> · <button type="button" className="link-btn" onClick={() => setRefOpen(true)}>{t('changeRef')}</button></>}
            {last.delta != null ? ` · ${t('delta', { delta: fmtDelta(f, last.delta) })}` : ''}
          </div>
        </div>
      )}

      {points.length > 0 && (
        <>
          <div className="seg" style={{ maxWidth: 400 }}>
            {periods.map((p) => (
              <button key={p} type="button" className={`seg__btn ${period === p ? 'seg__btn--active' : ''}`} onClick={() => setPeriod(p)}>{t(`period.${p}`)}</button>
            ))}
          </div>
          <div className="card" style={{ padding: '12px 6px 6px' }}>
            <LabChart points={filteredPoints} refLow={refLow} refHigh={refHigh} unit={last?.unit} />
          </div>
          <div className="series-table">
            {filteredPoints.slice().reverse().map((p, i) => {
              const flag = flagFor(p.valueNum, p.refLow ?? refLow, p.refHigh ?? refHigh);
              const val = labValueText(f, p.valueNum, p.valueText);
              const row = (
                <>
                  <div className="series-row__date">{f.date(p.date)}</div>
                  <div className={`series-row__val ${flag && flag !== 'ok' ? 'series-row__val--warn' : ''}`}>{val}</div>
                  <div className="series-row__meta">{p.delta != null ? fmtDelta(f, p.delta) : ''}{p.unit ? ` ${p.unit}` : ''}</div>
                  {p.documentId && <Icon name="chevron" size={20} style={{ color: 'var(--border-2)', marginLeft: 'auto' }} />}
                </>
              );
              return p.documentId
                ? <Link key={i} href={`/labs/documents/${encodeURIComponent(String(p.documentId))}`} className="series-row" style={{ color: 'inherit' }}>{row}</Link>
                : <div key={i} className="series-row">{row}</div>;
            })}
            {!filteredPoints.length && <div className="series-row muted">{t('noDataPeriod')}</div>}
          </div>
        </>
      )}

      {!error && points.length === 0 && (
        <div className="card coming-soon"><div className="coming-soon__desc">{t('noData')}</div></div>
      )}

      {testKey && onRefsChanged && <RefSheet open={refOpen} onClose={() => setRefOpen(false)} testKey={testKey} onSaved={onRefsChanged} />}
      <BiomarkerSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        testKey={testKey}
        title={title}
        last={last ? { valueNum: last.valueNum, valueText: last.valueText, unit: last.unit, refLow, refHigh, date: last.date } : null}
        points={points}
      />
    </div>
  );
}
