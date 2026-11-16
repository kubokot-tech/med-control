'use client';

import { useTranslations } from 'use-intl';

type Pt = { valueNum: number | null };

export default function Sparkline({
  points,
  width = 120,
  height = 28,
  stroke = 'var(--chart-line)',
  showArea = true,
  refLow,
  refHigh,
  pulse = false,
}: {
  points: Pt[];
  width?: number;
  height?: number;
  stroke?: string;
  showArea?: boolean;
  refLow?: number | null;
  refHigh?: number | null;
  pulse?: boolean;
}) {
  const t = useTranslations('labs');
  const nums = points
    .map((p) => p.valueNum)
    .filter((x): x is number => typeof x === 'number' && !Number.isNaN(x));
  if (nums.length === 0) {
    return (
      <div style={{ width, height, background: 'var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--fg-3)' }}>
        {t('sparkline.noData')}
      </div>
    );
  }
  // one value so far (the first diary entry): a dot in the middle instead of «no data»
  if (nums.length === 1) {
    return (
      <svg width={width} height={height} aria-label={t('sparkline.single')}>
        <line x1={2} x2={width - 2} y1={height / 2} y2={height / 2} stroke="var(--border)" strokeDasharray="2 3" />
        <circle cx={width / 2} cy={height / 2} r={pulse ? 3.5 : 3} fill={stroke} />
      </svg>
    );
  }

  const padding = 2;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (refLow != null) min = Math.min(min, refLow);
  if (refHigh != null) max = Math.max(max, refHigh);
  const span = max - min || 1;

  const toY = (v: number) => padding + (height - padding * 2) - ((v - min) / span) * (height - padding * 2);

  const stepX = (width - padding * 2) / Math.max(1, points.length - 1);
  const coords = points
    .map((p, i) => {
      const v =
        typeof p.valueNum === 'number' && !Number.isNaN(p.valueNum)
          ? p.valueNum
          : null;
      const x = padding + i * stepX;
      const y = v === null ? null : toY(v);
      return { x, y };
    })
    .filter((c) => c.y !== null) as Array<{ x: number; y: number }>;

  const d = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');

  const areaD =
    d +
    ` L ${coords[coords.length - 1].x.toFixed(2)} ${height} L ${coords[0].x.toFixed(2)} ${height} Z`;

  const refLineY = (v: number | null | undefined) => {
    if (v == null) return null;
    const y = toY(v);
    if (y < padding || y > height - padding) return null;
    return y;
  };

  const refLowY = refLineY(refLow);
  const refHighY = refLineY(refHigh);

  const lastPt = coords[coords.length - 1];

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ borderRadius: 6, display: 'block' }}
    >
      {/* Reference zone band */}
      {refLowY != null && refHighY != null && (
        <rect
          x={padding}
          y={refHighY}
          width={width - padding * 2}
          height={Math.max(0, refLowY - refHighY)}
          fill="var(--chart-ref-zone)"
        />
      )}
      {/* Ref lines */}
      {refHighY != null && (
        <line
          x1={padding} x2={width - padding}
          y1={refHighY} y2={refHighY}
          stroke="var(--chart-ref)" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5"
        />
      )}
      {refLowY != null && (
        <line
          x1={padding} x2={width - padding}
          y1={refLowY} y2={refLowY}
          stroke="var(--chart-ref)" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5"
        />
      )}
      {showArea && (
        <path d={areaD} fill={stroke} opacity="0.1" />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot with optional pulse */}
      {lastPt && (
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="3"
          fill={stroke}
          className={pulse ? 'sparkline-pulse' : undefined}
        />
      )}
    </svg>
  );
}
