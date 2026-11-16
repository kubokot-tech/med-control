'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from '../../ui/icons';
import BottomSheet from '../../ui/BottomSheet';
import BiomarkerSheet from '../../ui/BiomarkerSheet';
import { flagFor, apiFetch, refText, labValueText } from '../../ui/labUtils';
import { todayKey } from '../../ui/api';
import { useFormat } from '../../ui/format';
import { activeLanguage } from '../../i18n/messages';

type SummaryCell = { valueNum?: number | null; valueText?: string | null; collectedAt?: string | null; documentId?: string | null; n?: number };
type SummaryRow = {
  test: string;
  name?: string | null;
  short?: string | null;
  sortOrder?: number;
  isCanonical?: boolean;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  cells: Record<string, SummaryCell>;
};
type SummaryResp = { months: string[]; rows: SummaryRow[]; labs?: string[] };

const RANGES = ['3m', '6m', '12m', 'all'] as const;
const isRange = (r: string): r is typeof RANGES[number] => (RANGES as readonly string[]).includes(r);

function Inner() {
  const f = useFormat();
  const t = useTranslations('labs');
  const fmtYm = (ym: string) => f.date(`${ym}-01`, { month: 'short', year: '2-digit' });
  const fmtNum = (n: number) => f.number(n, { maximumFractionDigits: 4 });
  const sp = useSearchParams();
  const router = useRouter();
  const cat = (sp.get('cat') || 'blood').toLowerCase();
  const range = (sp.get('range') || '6m').toLowerCase();
  const pick = (sp.get('pick') || 'worst').toLowerCase();
  const fromYm = sp.get('from_ym') || '';
  const toYm = sp.get('to_ym') || '';
  const lab = sp.get('lab') || '';

  const [data, setData] = useState<SummaryResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sheetRow, setSheetRow] = useState<SummaryRow | null>(null);

  function buildUrl(overrides: Record<string, string>) {
    const p: Record<string, string> = { cat, range, lab, from_ym: fromYm, to_ym: toYm, pick, ...overrides };
    const qs = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `/labs/summary${qs ? '?' + qs : ''}`;
  }
  function qs() {
    const p = new URLSearchParams();
    if (cat) p.set('cat', cat);
    if (range) p.set('range', range);
    if (pick && pick !== 'worst') p.set('pick', pick);
    if (fromYm) p.set('from_ym', fromYm);
    if (toYm) p.set('to_ym', toYm);
    if (lab) p.set('lab', lab);
    return p.toString() ? `?${p.toString()}` : '';
  }

  const [exportAll, setExportAll] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  async function download(kind: 'xlsx' | 'jsonl' | 'pdf' | 'csv') {
    setExporting(kind);
    try {
      const path = { xlsx: '/api/gateway/labs/export/summary.xlsx', jsonl: '/api/gateway/labs/export/observations.jsonl', pdf: '/api/gateway/labs/export/summary.pdf', csv: '/api/gateway/labs/export/results.csv' }[kind];
      const query = exportAll ? `?cat=${cat}&range=all&pick=${pick}` : qs();
      const r = await apiFetch(path + query);
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      const cd = r.headers.get('content-disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      a.download = m ? decodeURIComponent(m[1]) : `${activeLanguage() === 'ru' ? 'medcontrol-analizy' : 'medcontrol-labs'}-${cat}-${todayKey()}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 2000);
      setExportOpen(false);
    } catch (e: any) {
      setErr(t('summary.exportFailed', { error: String(e?.message || e) }));
    } finally { setExporting(null); }
  }

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr(null);
    apiFetch('/api/gateway/labs/summary' + qs())
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        const j = (await r.json()) as SummaryResp;
        if (alive) setData(j);
      })
      .catch((e) => alive && setErr(String(e?.message || e)))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, range, fromYm, toYm, lab, pick]);

  const months = data?.months || [];
  const rows = useMemo(() => {
    const rr = (data?.rows || []).slice();
    rr.sort((a, b) => (a.sortOrder ?? 1000) - (b.sortOrder ?? 1000) || (a.name || a.test).localeCompare(b.name || b.test, f.language));
    return rr;
  }, [data, f.language]);

  const activeFilters = (lab ? 1 : 0) + (fromYm || toYm ? 1 : 0);

  const sheetLast = useMemo(() => {
    if (!sheetRow) return null;
    const lastYm = [...months].reverse().find((m) => sheetRow.cells[m]);
    const c = lastYm ? sheetRow.cells[lastYm] : null;
    return c ? { valueNum: c.valueNum ?? null, valueText: c.valueText ?? null, unit: sheetRow.unit, refLow: sheetRow.refLow, refHigh: sheetRow.refHigh, date: c.collectedAt ?? null } : null;
  }, [sheetRow, months]);
  const sheetPoints = useMemo(() => sheetRow ? months.map((m) => ({ valueNum: sheetRow.cells[m]?.valueNum ?? null })) : [], [sheetRow, months]);

  return (
    <>
      <div className="labs-toolbar">
        <div className="seg" style={{ maxWidth: 220 }}>
          {(['blood', 'urine'] as const).map((v) => (
            <Link key={v} href={buildUrl({ cat: v })} className={`seg__btn ${cat === v ? 'seg__btn--active' : ''}`}>{t(`summary.cat.${v}`)}</Link>
          ))}
        </div>
        <div className="seg" style={{ maxWidth: 320 }}>
          {RANGES.map((v) => (
            <Link key={v} href={buildUrl({ range: v, from_ym: '', to_ym: '' })} className={`seg__btn ${range === v && !fromYm && !toYm ? 'seg__btn--active' : ''}`}>{t(`summary.range.${v}`)}</Link>
          ))}
        </div>
        <div className="seg" style={{ maxWidth: 260 }} title={t('summary.pickTitle')}>
          {(['worst', 'latest'] as const).map((v) => (
            <Link key={v} href={buildUrl({ pick: v })} className={`seg__btn ${pick === v ? 'seg__btn--active' : ''}`}>{t(`summary.pick.${v}`)}</Link>
          ))}
        </div>
        <div className="labs-toolbar__end">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setFiltersOpen(true)}>
            {t('summary.filters')}{activeFilters ? ` · ${activeFilters}` : ''}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setExportOpen(true)}><Icon name="download" />{t('summary.export')}</button>
        </div>
      </div>

      {err && <div className="msg msg--error">{err}</div>}

      {!data && busy && <div className="skeleton" style={{ height: 320, borderRadius: 18 }} />}

      {data && (
        <div className="pivot">
          <table>
            <thead>
              <tr>
                <th>{t('summary.marker')}</th>
                {months.map((m) => <th key={m}>{fmtYm(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ref = refText(f, r.refLow, r.refHigh);
                const seriesHref = r.isCanonical ? `/labs/series?key=${encodeURIComponent(r.test)}` : `/labs/series-raw?test=${encodeURIComponent(r.test)}`;
                return (
                  <tr key={r.test}>
                    <td>
                      <div className="pivot__name">
                        {r.isCanonical
                          ? <button type="button" className="pivot__name-btn" onClick={() => setSheetRow(r)} title={t('summary.whatIsIt')}>{r.short || r.name || r.test}</button>
                          : <Link href={seriesHref} className="pivot__name-plain">{r.name || r.test}</Link>}
                        <div className="pivot__code">
                          {r.isCanonical ? <Link href={seriesHref} className="muted">{r.test}</Link> : null}
                          {r.isCanonical && (ref || r.unit) ? ' · ' : ''}{ref}{r.unit ? ` ${r.unit}` : ''}
                        </div>
                      </div>
                    </td>
                    {months.map((m) => {
                      const c = r.cells?.[m];
                      if (!c) return <td key={m}><span className="muted">—</span></td>;
                      const text = labValueText(f, c.valueNum, c.valueText);
                      const flag = flagFor(c.valueNum ?? null, r.refLow ?? null, r.refHigh ?? null);
                      const cls = `pivot__cell ${flag ? `pivot__cell--${flag}` : ''}`;
                      const many = (c.n ?? 1) > 1;
                      const tip = many ? t('summary.cellTip', { n: c.n ?? 1, pick, date: c.collectedAt ? f.date(c.collectedAt) : '' }) : undefined;
                      return (
                        <td key={m}>
                          {c.documentId
                            ? <Link href={`/labs/documents/${encodeURIComponent(String(c.documentId))}`} className={cls} title={tip}>{text}{many && <sup className="pivot__count">{c.n}</sup>}</Link>
                            : <span className={cls} title={tip}>{text}{many && <sup className="pivot__count">{c.n}</sup>}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={1 + months.length} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--fg-2)' }}>
                  {t('summary.empty')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && months.length > 3 && <div className="pivot__hint">{t('summary.scrollHint')}</div>}

      {/* Filters sheet */}
      <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('summary.filters')}>
        <div className="sheet__block">
          <div className="section-label">{t('summary.lab')}</div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            <Link href={buildUrl({ lab: '' })} onClick={() => setFiltersOpen(false)} className={`seg__btn ${!lab ? 'seg__btn--active' : ''}`}>{t('summary.allLabs')}</Link>
            {(data?.labs || []).map((x) => (
              <Link key={x} href={buildUrl({ lab: x })} onClick={() => setFiltersOpen(false)} className={`seg__btn ${lab === x ? 'seg__btn--active' : ''}`} style={{ flexGrow: 1 }}>{x}</Link>
            ))}
          </div>
        </div>
        <form
          className="sheet__block"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            router.push(buildUrl({ from_ym: String(fd.get('from_ym') || ''), to_ym: String(fd.get('to_ym') || ''), range: '' }));
            setFiltersOpen(false);
          }}
        >
          <div className="section-label">{t('summary.period')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input name="from_ym" type="month" defaultValue={fromYm} aria-label={t('summary.fromMonth')} style={{ flex: 1, minWidth: 0 }} />
            <input name="to_ym" type="month" defaultValue={toYm} aria-label={t('summary.toMonth')} style={{ flex: 1, minWidth: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn--primary" style={{ flexGrow: 1 }}>{t('summary.apply')}</button>
            <Link href={buildUrl({ from_ym: '', to_ym: '', lab: '', range: '6m' })} onClick={() => setFiltersOpen(false)} className="btn btn--ghost">{t('summary.reset')}</Link>
          </div>
        </form>
      </BottomSheet>

      {/* Export sheet */}
      <BottomSheet open={exportOpen} onClose={() => setExportOpen(false)} title={t('summary.exportTitle')}>
        <div className="sheet__block">
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('summary.exportNow', {
            cat,
            hasLab: lab ? 'yes' : 'no',
            lab,
            period: fromYm || toYm ? `${fromYm || '…'} — ${toYm || '…'}` : isRange(range) ? t(`summary.exportPeriod.${range}`) : range,
            pick,
          })}</div>
          <label className="list-row" style={{ cursor: 'pointer' }}><span>{t('summary.exportAll')}</span><input type="checkbox" checked={exportAll} onChange={(e) => setExportAll(e.target.checked)} /></label>
          <div className="sheet__list">
            <button type="button" className="sheet__row" onClick={() => download('xlsx')} disabled={!!exporting}><Icon name="download" /><span><b>Excel</b><br /><span className="muted" style={{ fontSize: 13 }}>{t('summary.exportXlsx')}</span></span>{exporting === 'xlsx' && <span className="muted">…</span>}</button>
            <button type="button" className="sheet__row" onClick={() => download('pdf')} disabled={!!exporting}><Icon name="doc" /><span><b>{t('summary.exportPdfTitle')}</b><br /><span className="muted" style={{ fontSize: 13 }}>{t('summary.exportPdf')}</span></span>{exporting === 'pdf' && <span className="muted">…</span>}</button>
            <button type="button" className="sheet__row" onClick={() => download('csv')} disabled={!!exporting}><Icon name="download" /><span><b>CSV</b><br /><span className="muted" style={{ fontSize: 13 }}>{t('summary.exportCsv')}</span></span>{exporting === 'csv' && <span className="muted">…</span>}</button>
            <button type="button" className="sheet__row" onClick={() => download('jsonl')} disabled={!!exporting}><Icon name="download" /><span><b>JSONL</b><br /><span className="muted" style={{ fontSize: 13 }}>{t('summary.exportJsonl')}</span></span>{exporting === 'jsonl' && <span className="muted">…</span>}</button>
          </div>
        </div>
      </BottomSheet>

      <BiomarkerSheet
        open={sheetRow != null}
        onClose={() => setSheetRow(null)}
        testKey={sheetRow?.isCanonical ? sheetRow.test : null}
        title={sheetRow?.short || sheetRow?.name || sheetRow?.test || ''}
        last={sheetLast}
        points={sheetPoints}
      />
    </>
  );
}

export default function SummaryClient() {
  return <Suspense fallback={<div className="skeleton" style={{ height: 320, borderRadius: 18 }} />}><Inner /></Suspense>;
}
