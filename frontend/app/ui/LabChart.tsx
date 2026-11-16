'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { useFormat } from './format';

type ChartPoint = {
  date: string;
  valueNum: number | null;
  valueText?: string | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  delta?: number | null;
  documentId?: string | null;
};

const CHART_H = 240;
const VB_MAX = 960;
const PAD = { top: 24, right: 24, bottom: 40, left: 58 };



function linearRegression(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of pts) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function getFlagColor(val: number, lo?: number | null, hi?: number | null): string {
  if (lo == null || hi == null) return 'var(--chart-dot-neutral)';
  if (val > hi) return 'var(--chart-dot-high)';
  if (val < lo) return 'var(--chart-dot-low)';
  return 'var(--chart-dot-ok)';
}

/** Deviation from the range as a message key of labs.chart and the percentage. */
function getDeviation(val: number, lo?: number | null, hi?: number | null): { key: 'above' | 'below' | 'inRange'; pct: string } | null {
  if (lo == null || hi == null) return null;
  if (val > hi) {
    const pct = ((val - hi) / hi * 100).toFixed(0);
    return { key: 'above', pct };
  }
  if (val < lo) {
    const pct = ((lo - val) / lo * 100).toFixed(0);
    return { key: 'below', pct };
  }
  return { key: 'inRange', pct: '' };
}

export default function LabChart({
  points,
  refLow,
  refHigh,
  unit,
  showTrend = true,
}: {
  points: ChartPoint[];
  refLow?: number | null;
  refHigh?: number | null;
  unit?: string | null;
  showTrend?: boolean;
}) {
  const f = useFormat();
  const t = useTranslations('labs');
  const fmtDate = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', year: '2-digit' });
  const fmtNum = (n: number) => f.number(Math.abs(n) < 1e-9 ? 0 : n, { maximumFractionDigits: 4 });
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [pathLength, setPathLength] = useState(0);
  // Coordinate width follows the real width, so a phone gets a tall, readable chart instead of a scaled-down strip.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vbW, setVbW] = useState(VB_MAX);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setVbW(Math.max(320, Math.min(VB_MAX, w))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const valid = points
    .map((p, i) => ({ ...p, origIdx: i }))
    .filter((p) => p.valueNum != null && !Number.isNaN(p.valueNum));

  const hasEnoughData = valid.length >= 2;

  // Measure path length for animation
  useEffect(() => {
    if (lineRef.current) {
      setPathLength(lineRef.current.getTotalLength());
    }
  }, [valid.length, vbW]);

  // All hooks MUST be above this point — no early returns before hooks
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !hasEnoughData) return;

    const rect = svg.getBoundingClientRect();
    const scaleX = vbW / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const iW = vbW - PAD.left - PAD.right;

    // Recompute coords inline to avoid stale closure
    const nums = valid.map((p) => p.valueNum as number);
    let dMin = Math.min(...nums);
    let dMax = Math.max(...nums);
    if (refLow != null) dMin = Math.min(dMin, refLow);
    if (refHigh != null) dMax = Math.max(dMax, refHigh);
    const sp = dMax - dMin || 1;
    const yMn = dMin - sp * 0.1;
    const yMx = dMax + sp * 0.1;
    const ySp = yMx - yMn;
    const iH = CHART_H - PAD.top - PAD.bottom;

    const toXLocal = (i: number) => PAD.left + (i / Math.max(1, valid.length - 1)) * iW;
    const toYLocal = (v: number) => PAD.top + iH - ((v - yMn) / ySp) * iH;

    const localCoords = valid.map((p, i) => ({
      x: toXLocal(i),
      y: toYLocal(p.valueNum as number),
    }));

    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < localCoords.length; i++) {
      const dist = Math.abs(localCoords[i].x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    if (minDist < iW / localCoords.length + 20) {
      setHover({ idx: closest, x: localCoords[closest].x, y: localCoords[closest].y });
    } else {
      setHover(null);
    }
  }, [valid, hasEnoughData, refLow, refHigh, vbW]);

  // Not enough data — show placeholder
  if (!hasEnoughData) {
    return (
      <div style={{
        height: CHART_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--chart-bg)',
        borderRadius: 10,
        color: 'var(--chart-label)',
        fontSize: 13,
      }}>
        {valid.length === 0 ? t('chart.noData') : t('chart.notEnough')}
      </div>
    );
  }

  // Chart calculations (only when hasEnoughData)
  const nums = valid.map((p) => p.valueNum as number);
  let dataMin = Math.min(...nums);
  let dataMax = Math.max(...nums);
  if (refLow != null) dataMin = Math.min(dataMin, refLow);
  if (refHigh != null) dataMax = Math.max(dataMax, refHigh);
  const span = dataMax - dataMin || 1;
  const yMin = dataMin - span * 0.1;
  const yMax = dataMax + span * 0.1;
  const ySpan = yMax - yMin;

  const innerW = vbW - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const toX = (i: number) => PAD.left + (i / Math.max(1, valid.length - 1)) * innerW;
  const toY = (v: number) => PAD.top + innerH - ((v - yMin) / ySpan) * innerH;

  const coords = valid.map((p, i) => ({
    x: toX(i),
    y: toY(p.valueNum as number),
    point: p,
    idx: i,
  }));

  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    linePath +
    ` L ${coords[coords.length - 1].x.toFixed(1)} ${(PAD.top + innerH).toFixed(1)}` +
    ` L ${coords[0].x.toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

  // Trend line
  let trendPath = '';
  if (showTrend && coords.length >= 3) {
    const trendPts = coords.map((c, i) => ({ x: i, y: c.point.valueNum as number }));
    const reg = linearRegression(trendPts);
    if (reg) {
      const y0 = toY(reg.intercept);
      const y1 = toY(reg.slope * (coords.length - 1) + reg.intercept);
      trendPath = `M ${coords[0].x.toFixed(1)} ${y0.toFixed(1)} L ${coords[coords.length - 1].x.toFixed(1)} ${y1.toFixed(1)}`;
    }
  }

  // Y axis ticks
  const yTicks: number[] = [];
  const niceStep = (s: number) => {
    const raw = s / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return norm <= 1 ? mag : norm <= 2 ? 2 * mag : norm <= 5 ? 5 * mag : 10 * mag;
  };
  const step = niceStep(ySpan);
  let tick = Math.ceil(yMin / step) * step;
  while (tick <= yMax) {
    yTicks.push(tick);
    tick += step;
  }
  if (refLow != null && !yTicks.includes(refLow)) yTicks.push(refLow);
  if (refHigh != null && !yTicks.includes(refHigh)) yTicks.push(refHigh);
  yTicks.sort((a, b) => a - b);

  // X axis labels
  const maxXLabels = Math.min(Math.max(3, Math.floor(vbW / 110)), valid.length);
  const xLabelIndices: number[] = [];
  if (valid.length <= maxXLabels) {
    valid.forEach((_, i) => xLabelIndices.push(i));
  } else {
    for (let i = 0; i < maxXLabels; i++) {
      xLabelIndices.push(Math.round((i / (maxXLabels - 1)) * (valid.length - 1)));
    }
  }

  const hp = hover ? coords[hover.idx]?.point : null;
  const hpDevKey = hp?.valueNum != null ? getDeviation(hp.valueNum, refLow, refHigh) : null;
  const hpDev = hpDevKey ? t(`chart.${hpDevKey.key}`, { pct: hpDevKey.pct }) : null;
  const hpFlag = hp?.valueNum != null ? getFlagColor(hp.valueNum, refLow, refHigh) : 'var(--chart-dot-neutral)';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width="100%"
        height={CHART_H}
        viewBox={`0 0 ${vbW} ${CHART_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', borderRadius: 10, background: 'var(--chart-bg)' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Reference zone */}
        {refLow != null && refHigh != null && (
          <rect
            x={PAD.left}
            y={toY(refHigh)}
            width={innerW}
            height={Math.max(0, toY(refLow) - toY(refHigh))}
            fill="var(--chart-ref-zone)"
          />
        )}

        {/* Grid lines + Y labels */}
        {yTicks.map((v) => {
          const y = toY(v);
          const isRef = v === refLow || v === refHigh;
          return (
            <g key={v}>
              <line
                x1={PAD.left} x2={PAD.left + innerW}
                y1={y} y2={y}
                stroke={isRef ? 'var(--chart-ref)' : 'var(--chart-grid)'}
                strokeWidth={isRef ? 1.5 : 0.5}
                strokeDasharray={isRef ? '6 3' : 'none'}
              />
              <text
                x={PAD.left - 8} y={y + 4}
                textAnchor="end" fontSize={11}
                fill={isRef ? 'var(--chart-ref)' : 'var(--chart-label)'}
                fontWeight={isRef ? 600 : 400}
              >
                {fmtNum(v)}
              </text>
            </g>
          );
        })}

        {/* X axis labels */}
        {xLabelIndices.map((i, k) => (
          <text
            key={i} x={coords[i].x} y={CHART_H - 8}
            textAnchor={k === 0 ? 'start' : k === xLabelIndices.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--chart-label)"
          >
            {fmtDate(valid[i].date)}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="var(--chart-line)" opacity="0.06" />

        {/* Trend line */}
        {trendPath && (
          <path d={trendPath} fill="none" stroke="var(--chart-trend)" strokeWidth="1.5" strokeDasharray="8 4" opacity="0.5" />
        )}

        {/* Main line */}
        <path
          ref={lineRef}
          d={linePath}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={pathLength ? {
            strokeDasharray: pathLength,
            strokeDashoffset: 0,
            animation: 'chart-draw 800ms ease-out',
            ['--path-length' as any]: pathLength,
          } : undefined}
        />

        {/* Data points */}
        {coords.map((c, i) => (
          <circle
            key={i} cx={c.x} cy={c.y}
            r={hover?.idx === i ? 7 : 4}
            fill={getFlagColor(c.point.valueNum as number, refLow, refHigh)}
            stroke="var(--surface)" strokeWidth="2"
            style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
          />
        ))}

        {/* Hover crosshair */}
        {hover && (
          <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + innerH}
            stroke="var(--chart-label)" strokeWidth="1" strokeDasharray="4 2" />
        )}
      </svg>

      {/* Enhanced Tooltip */}
      {hover && hp && (
        <div style={{
          position: 'absolute',
          left: `${(hover.x / vbW) * 100}%`,
          top: `${(hover.y / CHART_H) * 100 - 2}%`,
          transform: hover.x > 700 ? 'translate(-110%, -100%)' : 'translate(10%, -100%)',
          background: 'var(--chart-tooltip-bg)',
          color: 'var(--chart-tooltip-fg)',
          padding: '10px 14px',
          borderRadius: 10,
          fontSize: 12,
          lineHeight: 1.6,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          borderLeft: `3px solid ${hpFlag}`,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{fmtDate(hp.date)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: hpFlag, display: 'inline-block' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>{hp.valueNum != null ? fmtNum(hp.valueNum) : '—'}</span>
            {unit && <span style={{ opacity: 0.6 }}>{unit}</span>}
          </div>
          {hpDev && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{hpDev}</div>}
          {hp.delta != null && (
            <div style={{ fontSize: 11, opacity: 0.8 }}>{/* a rise is not always bad, a fall not always good: no red/green */}
              Δ {hp.delta > 0 ? '+' : ''}{fmtNum(hp.delta)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
