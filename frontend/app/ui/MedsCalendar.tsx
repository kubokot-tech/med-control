'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import Icon from './icons';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { isDoseDay, type Schedule } from './schedule';
import { useFormat } from './format';

type Admin = { id: string; takenAt: string | null; createdAt: string; status: string; day?: string; doseNo?: number };
type Status = 'TAKEN' | 'SKIPPED' | 'PAUSED' | 'CLEAR';

const ACTIONS: [Status, string][] = [['TAKEN', 'btn--primary'], ['SKIPPED', 'btn--secondary'], ['PAUSED', 'btn--secondary'], ['CLEAR', 'btn--ghost']];
const LABELS = ['TAKEN', 'SKIPPED', 'PAUSED', 'MISSED', 'PARTIAL'] as const;
const isLabel = (s: string): s is typeof LABELS[number] => (LABELS as readonly string[]).includes(s);

/** The day as a whole from its marks (the gateway's rule, lib/medsDays.js): all doses taken, some, skipped, pause. */
function dayStatus(marks: Admin[], times: number): string {
  const taken = marks.filter((a) => a.status === 'TAKEN').length;
  if (taken >= times) return 'TAKEN';
  if (taken > 0) return 'PARTIAL';
  if (marks.some((a) => a.status === 'PAUSED')) return 'PAUSED';
  if (marks.some((a) => a.status === 'SKIPPED')) return 'SKIPPED';
  return marks[0].status;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Month calendar of doses: tap a day to set its status, or mark a whole period.
 * Past days only; PAUSED is a therapy pause (not counted as missed). With several doses a day TAKEN marks all of
 * them, and a day with only some taken shows as partial.
 */
export default function MedsCalendar({ open, onClose, medicationId, regimenItemId, regimenStart, today, onChanged, schedule }:
  { open: boolean; onClose: () => void; medicationId: string; regimenItemId?: string; regimenStart: string | null; today: string; onChanged: () => void; schedule?: (Schedule & { timesPerDay?: number }) | null }) {
  const times = Math.max(1, schedule?.timesPerDay || 1);
  const t = useTranslations('meds.calendar');
  const label = (s: string) => (isLabel(s) ? t(`label.${s}`) : s);
  const format = useFormat();
  const [y, setY] = useState(Number(today.slice(0, 4)));
  const [m, setM] = useState(Number(today.slice(5, 7)) - 1);
  const [byDay, setByDay] = useState<Map<string, string>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const from = ymd(y, m, 1);
  const to = ymd(y, m, new Date(y, m + 1, 0).getDate());

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/gateway/meds/administrations?medication_id=${medicationId}&from=${from}&to=${to}`);
    if (!r.ok) { setErr(await r.text()); return; }
    const list: Admin[] = (await r.json()).administrations || [];
    const marks = new Map<string, Admin[]>();
    for (const a of list) { const k = a.day || (a.takenAt || a.createdAt).slice(0, 10); marks.set(k, [...(marks.get(k) || []), a]); }
    setByDay(new Map([...marks].map(([k, v]) => [k, dayStatus(v, times)])));
  }, [medicationId, from, to, times]);
  useEffect(() => { if (open) { load(); setSel(null); } }, [open, load]);

  async function apply(start: string, end: string, status: Status) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/meds/administrations/days', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medication_id: medicationId, regimen_item_id: regimenItemId, from: start, to: end, status }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setMsg(start === end
        ? (status === 'CLEAR' ? t('dayCleared', { day: fmt(start) }) : t('daySet', { day: fmt(start), status: label(status) }))
        : (status === 'CLEAR' ? t('rangeCleared', { from: fmt(start), to: fmt(end), days: j.days }) : t('rangeSet', { from: fmt(start), to: fmt(end), status: label(status), days: j.days })));
      setSel(null);
      await load();
      onChanged();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const cells = useMemo(() => {
    const first = new Date(y, m, 1);
    const lead = ((first.getDay() || 7) - format.weekStart + 7) % 7; // empty cells before the 1st, from the user's first weekday
    const n = new Date(y, m + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= n; d++) out.push(ymd(y, m, d));
    return out;
  }, [y, m, format.weekStart]);

  function prev() { if (m === 0) { setY(y - 1); setM(11); } else setM(m - 1); setSel(null); }
  function next() { if (m === 11) { setY(y + 1); setM(0); } else setM(m + 1); setSel(null); }
  const fmt = (k: string) => format.date(k, { day: 'numeric', month: 'short' });
  const canNext = (m === 11 ? ymd(y + 1, 0, 1) : ymd(y, m + 1, 1)) <= today;

  return (
    <BottomSheet open={open} onClose={onClose} title={t('title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={prev} aria-label={t('prevMonth')}><Icon name="back" /></button>
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 17 }}>{format.months()[m]} {y}</div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={next} disabled={!canNext} aria-label={t('nextMonth')}><Icon name="chevron" /></button>
        </div>
        <div className="cal-grid">
          {format.weekdays().map(([iso, d]) => <div key={iso} className="cal-dow">{d}</div>)}
          {cells.map((k, i) => {
            if (!k) return <div key={`e${i}`} />;
            const st = byDay.get(k) || null;
            const future = k > today;
            const onRegimen = regimenStart && k >= regimenStart && isDoseDay(schedule, k, regimenStart);
            const cls = st === 'TAKEN' ? 'cal-day--taken' : st === 'PARTIAL' ? 'cal-day--partial' : st === 'SKIPPED' ? 'cal-day--skipped' : st === 'PAUSED' ? 'cal-day--paused' : onRegimen && k < today ? 'cal-day--missed' : '';
            return (
              <button key={k} type="button" className={`cal-day ${cls} ${sel === k ? 'cal-day--sel' : ''} ${k === today ? 'cal-day--today' : ''}`} disabled={future || busy} onClick={() => setSel(sel === k ? null : k)} title={t('dayTitle', { day: fmt(k), status: st ? label(st) : onRegimen && k < today ? t('label.MISSED') : '' })}>
                {Number(k.slice(8, 10))}
              </button>
            );
          })}
        </div>
        <div className="streak-legend" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <span><i className="streak__day streak__day--taken" />{times > 1 ? t('takenAll', { times }) : t('label.TAKEN')}</span>
          {times > 1 && <span><i className="streak__day streak__day--partial" />{t('partial')}</span>}
          <span><i className="streak__day streak__day--skipped" />{t('label.SKIPPED')}</span>
          <span><i className="streak__day streak__day--paused" />{t('label.PAUSED')}</span>
          <span><i className="streak__day streak__day--missed" />{t('label.MISSED')}</span>
        </div>
        {sel && (
          <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>{byDay.get(sel) ? t('dayNow', { day: fmt(sel), status: label(byDay.get(sel)!) }) : fmt(sel)}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ACTIONS.map(([s, c]) => <button key={s} type="button" className={`btn btn--sm ${c}`} disabled={busy} onClick={() => apply(sel, sel, s)}>{t(`actions.${s}`)}</button>)}
            </div>
          </div>
        )}
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>{t('period')}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>{t('from')}</span><input type="date" value={range.from} max={today} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
              <label className="field"><span>{t('to')}</span><input type="date" value={range.to} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ACTIONS.map(([s, c]) => <button key={s} type="button" className={`btn btn--sm ${c}`} disabled={busy || !range.from || !range.to} onClick={() => apply(range.from, range.to, s)}>{t(`actions.${s}`)}</button>)}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{t('pauseHint')}</div>
          </div>
        </details>
        {err && <div className="msg msg--error">{err}</div>}
        {msg && <div className="msg msg--ok">{msg}</div>}
      </div>
    </BottomSheet>
  );
}
