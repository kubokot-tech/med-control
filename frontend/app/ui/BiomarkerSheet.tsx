'use client';

import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import Sparkline from './Sparkline';
import { BIOMARKER_DB } from './BiomarkerInfo';
import { flagFor, refText, labValueText } from './labUtils';
import { useProtocol } from './protocol';
import { useFormat } from './format';

export type SheetValue = {
  valueNum?: number | null;
  valueText?: string | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  date?: string | null;
};

/** Description of a marker (catalog key) in a bottom sheet / side panel, with the current value on top. */
export default function BiomarkerSheet({
  open,
  onClose,
  testKey,
  title,
  last,
  points,
}: {
  open: boolean;
  onClose: () => void;
  testKey: string | null;
  title: string;
  last?: SheetValue | null;
  points?: { valueNum: number | null }[];
}) {
  const f = useFormat();
  const t = useTranslations('labs');
  const tb = useTranslations('biomarkers');
  const deviation = (v: number, lo: number, hi: number) => {
    if (v > hi) return t('biomarkerSheet.above', { pct: Math.round(((v - hi) / hi) * 100) });
    if (v < lo) return t('biomarkerSheet.below', { pct: Math.round(((lo - v) / lo) * 100) });
    return t('biomarkerSheet.inRange');
  };
  const fmtNum = (n: number) => f.number(n, { maximumFractionDigits: 4 });
  const info = testKey ? BIOMARKER_DB[testKey] : null;
  const protocol = useProtocol();
  const note = testKey ? protocol?.markerNotes?.[testKey] : null;
  const v = last?.valueNum ?? null;
  const lo = last?.refLow ?? null;
  const hi = last?.refHigh ?? null;
  const flag = flagFor(v, lo, hi);
  const tone = flag === 'ok' ? 'ok' : flag ? 'warn' : 'muted';

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {info && <div className="muted" style={{ marginTop: -8 }}>{tb(`${info}.fullName`)}</div>}

      {last && (v != null || last.valueText) && (
        <div className={`value-card value-card--${tone}`}>
          <div className="value-card__num">{labValueText(f, v, last.valueText)}</div>
          <div>
            <div className="value-card__title">
              {v != null && lo != null && hi != null ? deviation(v, lo, hi) : t('biomarkerSheet.last')}
            </div>
            <div className="value-card__sub">
              {refText(f, lo, hi) ? t('biomarkerSheet.range', { range: refText(f, lo, hi) }) : t('biomarkerSheet.noRange')}
              {last.unit ? ` ${last.unit}` : ''}
              {last.date ? ` · ${f.date(last.date)}` : ''}
            </div>
          </div>
        </div>
      )}

      {points && points.length > 1 && (
        <div style={{ padding: '4px 0' }}>
          <Sparkline points={points} width={360} height={56} stroke={flag && flag !== 'ok' ? 'var(--warn)' : 'var(--accent)'} refLow={lo} refHigh={hi} />
        </div>
      )}

      {info ? (
        <>
          <div className="sheet__block"><div className="section-label">{t('biomarkerSheet.what')}</div><div>{tb(`${info}.what`)}</div></div>
          <div className="sheet__block"><div className="section-label">{t('biomarkerSheet.whyMatters')}</div><div>{tb(`${info}.whyMatters`)}</div></div>
          <div className="sheet__block"><div className="section-label">{t('biomarkerSheet.high')}</div><div>{tb(`${info}.highMeans`)}</div></div>
          <div className="sheet__block"><div className="section-label">{t('biomarkerSheet.low')}</div><div>{tb(`${info}.lowMeans`)}</div></div>
          {note && protocol && <div className="sheet__block sheet__block--accent"><div className="section-label">{protocol.name}</div><div>{note}</div></div>}
        </>
      ) : (
        <div className="muted">{t('biomarkerSheet.noInfo')}</div>
      )}
    </BottomSheet>
  );
}
