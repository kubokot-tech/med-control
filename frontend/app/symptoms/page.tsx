'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import Sparkline from '../ui/Sparkline';
import { apiFetch } from '../ui/labUtils';
import { todayKey } from '../ui/api';
import { loadProtocol } from '../ui/protocol';
import { useFormat } from '../ui/format';
import { bodyUnits, type BodyUnits } from '../../../shared/units.js';
import type { Format } from '../../../shared/format.js';

// Scale values arrive under their catalog keys (fatigue, edema, jointPain…); which ones the diary shows comes from the protocol.
type Entry = {
  date: string;
  wellbeing: number | null; tempC: number | null; bpSys: number | null; bpDia: number | null; weightKg: number | null;
  pulse: number | null; steps: number | null; notes: string | null;
  [scale: string]: any;
};
type Scale = { key: string; label: string; hint: string };

type T = ReturnType<typeof useTranslations<'symptoms'>>;

const LEVELS = ['none', 'mild', 'moderate', 'severe'] as const;
const WELLBEING = ['bad', 'meh', 'ok', 'good', 'great'] as const;

const empty = (date: string): Entry => ({
  date, wellbeing: null, tempC: null, bpSys: null, bpDia: null, weightKg: null, pulse: null, steps: null, notes: null,
});

function addDays(key: string, n: number) {
  const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function summary(e: Entry, catalog: Scale[], b: BodyUnits, f: Format, t: T) {
  const parts: string[] = [];
  if (e.wellbeing != null) parts.push(t('summary.wellbeing', { value: e.wellbeing }));
  if (e.bpSys != null && e.bpDia != null) parts.push(t('summary.bp', { sys: e.bpSys, dia: e.bpDia }));
  if (e.weightKg != null) parts.push(`${f.number(b.weight(e.weightKg))} ${b.weightUnit}`);
  if (e.tempC != null) parts.push(`${f.number(b.temperature(e.tempC))} ${b.temperatureUnit}`);
  if (e.pulse != null) parts.push(t('summary.pulse', { value: e.pulse }));
  // every scale with a complaint, mild ones too: a day with a mild tremor is not a day without complaints
  for (const s of catalog) { const v = e[s.key]; if (v != null && v >= 1) parts.push(t('summary.scale', { scale: s.label.toLowerCase(), level: t(`levels.${LEVELS[v as 1 | 2 | 3]}`) })); }
  return parts.join(' · ') || t('summary.none');
}

export default function SymptomsPage() {
  const t = useTranslations('symptoms');
  const f = useFormat();
  const fmtDay = (key: string) => f.date(key, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = (key: string) => f.date(key, { day: 'numeric', month: 'short' });
  const [today, setToday] = useState<string>(todayKey());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [form, setForm] = useState<Entry | null>(null);
  // Weight and temperature are typed and shown in the chosen units (kg/lb, °C/°F) and stored in kg and °C. While the
  // form is open its weightKg/tempC hold display values; the text fields keep what is being typed («70,»).
  const b = useMemo(() => bodyUnits({ temperature: f.temperature, weight: f.weight, language: f.language }), [f.temperature, f.weight, f.language]);
  const toDisplay = (e: Entry): Entry => ({ ...e, weightKg: b.weight(e.weightKg), tempC: b.temperature(e.tempC) });
  const numText = (v: number | null) => (v == null ? '' : String(v).replace('.', f.decimal));
  const [weightText, setWeightText] = useState('');
  const [tempText, setTempText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [scaleDefs, setScaleDefs] = useState<{ active: string[]; catalog: Scale[] } | null>(null);
  useEffect(() => {
    loadProtocol().then((r) => { if (r) setScaleDefs({ active: r.protocol.diaryScales || [], catalog: r.scaleCatalog || [] }); });
  }, []);
  // The protocol's scales, then any other scale that already has a value on this day (so nothing recorded is hidden).
  const scales: Scale[] = useMemo(() => {
    if (!scaleDefs) return [];
    const byKey = new Map(scaleDefs.catalog.map((x) => [x.key, x]));
    const extra = form ? scaleDefs.catalog.filter((x) => !scaleDefs.active.includes(x.key) && form[x.key] != null).map((x) => x.key) : [];
    return [...scaleDefs.active, ...extra].map((k) => byKey.get(k)).filter(Boolean) as Scale[];
  }, [scaleDefs, form]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await apiFetch('/api/gateway/symptoms?days=90');
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setToday(j.today);
      setEntries(j.entries || []);
      setDate((d) => d ?? (typeof window !== 'undefined' && /^\d{4}-\d{2}-\d{2}$/.test(new URLSearchParams(window.location.search).get('date') || '') ? new URLSearchParams(window.location.search).get('date')! : j.today));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Load the selected day into the form
  useEffect(() => {
    if (!date) return;
    const existing = entries.find((e) => e.date === date);
    const shown = toDisplay(existing ? { ...existing } : empty(date));
    setForm(shown); setWeightText(numText(shown.weightKg)); setTempText(numText(shown.tempC));
    setSaved(null);
  }, [date, entries, b]);

  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (s: string, int = false) => (s.trim() === '' ? null : int ? parseInt(s, 10) : parseFloat(s.replace(',', '.')));

  async function save() {
    if (!form || !date) return;
    setSaving(true);
    setErr(null);
    try {
      // only fields changed in this form: values that arrived meanwhile (Apple Health, Telegram) are not overwritten
      const base: any = toDisplay(entries.find((x) => x.date === date) || empty(date));
      const { date: _d, ...all } = form as any;
      const body: any = Object.fromEntries(Object.entries(all).filter(([k, v]) => k !== 'updatedAt' && v !== base[k]));
      if ('weightKg' in body) body.weightKg = b.weightIn(body.weightKg);
      if ('tempC' in body) body.tempC = b.temperatureIn(body.tempC);
      if (!Object.keys(body).length) { setSaved(f.time(new Date())); return; }
      const r = await apiFetch(`/api/gateway/symptoms/${date}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      setSaved(f.time(new Date()));
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  const series = useMemo(() => {
    const asc = entries.slice().reverse();
    return {
      bp: asc.map((e) => ({ valueNum: e.bpSys })),
      weight: asc.map((e) => ({ valueNum: b.weight(e.weightKg) })),
      lastBp: entries.find((e) => e.bpSys != null),
      lastW: entries.find((e) => e.weightKg != null),
    };
  }, [entries, b]);

  const isToday = date === today;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t.rich('desc', { link: (c) => <Link href="/settings/protocol/scales" className="link-btn">{c}</Link> })}</p>
      </div>

      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="sym-grid">
        <div className="card meds-card">
          {/* Day picker */}
          <div className="sym-day">
            <button type="button" className="series-head__back" aria-label={t('prevDay')} onClick={() => date && setDate(addDays(date, -1))}><Icon name="back" /></button>
            <div style={{ textAlign: 'center', flexGrow: 1 }}>
              <div className="sym-day__title">{isToday ? t('today') : date === addDays(today, -1) ? t('yesterday') : date ? fmtDay(date) : ''}</div>
              {date && !isToday && <div className="muted" style={{ fontSize: 14 }}>{fmtDay(date)}</div>}
            </div>
            <button type="button" className="series-head__back" aria-label={t('nextDay')} disabled={isToday} style={{ opacity: isToday ? .3 : 1, marginRight: -10, marginLeft: 0 }} onClick={() => date && !isToday && setDate(addDays(date, 1))}><Icon name="chevron" /></button>
          </div>

          {form && (
            <>
              <div className="sym-field">
                <div className="sym-field__label">{t('wellbeing')}</div>
                <div className="seg">
                  {WELLBEING.map((l, i) => (
                    <button key={i} type="button" className={`seg__btn ${form.wellbeing === i + 1 ? 'seg__btn--active' : ''}`} onClick={() => set('wellbeing', form.wellbeing === i + 1 ? null : i + 1)}>{t(`wellbeingLevels.${l}`)}</button>
                  ))}
                </div>
              </div>

              {scales.map((s) => (
                <div key={s.key} className="sym-field">
                  <div className="sym-field__label">{s.label}{s.hint && <span className="muted"> · {s.hint}</span>}</div>
                  <div className="seg">
                    {LEVELS.map((l, i) => (
                      <button key={i} type="button" className={`seg__btn ${form[s.key] === i ? 'seg__btn--active' : ''} ${form[s.key] === i && i >= 2 ? 'seg__btn--warn' : ''}`} onClick={() => set(s.key, form[s.key] === i ? null : i)}>{t(`levels.${l}`)}</button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="sym-numbers">
                <label className="field"><span>{t('fields.bpSys')}</span><input inputMode="numeric" placeholder="130" value={form.bpSys ?? ''} onChange={(e) => set('bpSys', num(e.target.value, true))} /></label>
                <label className="field"><span>{t('fields.bpDia')}</span><input inputMode="numeric" placeholder="80" value={form.bpDia ?? ''} onChange={(e) => set('bpDia', num(e.target.value, true))} /></label>
                <label className="field"><span>{t('fields.weight', { unit: b.weightUnit })}</span><input inputMode="decimal" placeholder={f.weight === 'lb' ? '155' : '70,5'} value={weightText} onChange={(e) => { setWeightText(e.target.value); set('weightKg', num(e.target.value)); }} /></label>
                <label className="field"><span>{t('fields.temperature', { unit: b.temperatureUnit })}</span><input inputMode="decimal" placeholder={f.temperature === 'f' ? '97,9' : '36,6'} value={tempText} onChange={(e) => { setTempText(e.target.value); set('tempC', num(e.target.value)); }} /></label>
                <label className="field"><span>{t('fields.pulse')}</span><input inputMode="numeric" placeholder="70" value={form.pulse ?? ''} onChange={(e) => set('pulse', e.target.value ? Math.round(Number(e.target.value)) : null)} /></label>
                <label className="field"><span>{t('fields.steps')}</span><input inputMode="numeric" placeholder="6000" value={form.steps ?? ''} onChange={(e) => set('steps', e.target.value ? Math.round(Number(e.target.value)) : null)} /></label>
              </div>

              <label className="field"><span>{t('fields.notes')}</span><textarea rows={2} placeholder={t('fields.notesPlaceholder')} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} /></label>

              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={saving}>
                <Icon name="check" strokeWidth={2.2} />{saving ? t('saving') : t('save')}
              </button>
              {saved && <div className="msg msg--ok" style={{ textAlign: 'center' }}>{t('savedAt', { time: saved })}</div>}
            </>
          )}
        </div>

        <div className="today-col">
          <div className="card meds-card">
            <div className="meds-card__row"><div className="card__title">{t('bp.title')}</div><div className="muted">{series.lastBp ? `${series.lastBp.bpSys}/${series.lastBp.bpDia} · ${fmtShort(series.lastBp.date)}` : t('noEntries')}</div></div>
            <Sparkline points={series.bp} width={360} height={56} stroke="var(--info)" refLow={90} refHigh={140} />
            <div className="muted" style={{ fontSize: 14 }}>{t('bp.hint')}</div>
          </div>
          <div className="card meds-card">
            <div className="meds-card__row"><div className="card__title">{t('weight.title')}</div><div className="muted">{series.lastW ? `${f.number(b.weight(series.lastW.weightKg))} ${b.weightUnit} · ${fmtShort(series.lastW.date)}` : t('noEntries')}</div></div>
            <Sparkline points={series.weight} width={360} height={56} stroke="var(--accent)" />
          </div>

          <div className="today-section">
            <div className="section-label">{t('recent.title')}</div>
            {loading && <div className="skeleton" style={{ height: 76 }} />}
            {!loading && entries.length === 0 && <div className="muted">{t('recent.empty')}</div>}
            {entries.slice(0, 14).map((e) => (
              <button key={e.date} type="button" className="event-card" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => { setDate(e.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <div className="event-card__icon event-card__icon--other"><Icon name="symptoms" size={22} /></div>
                <div className="event-card__body">
                  <div className="event-card__title">{e.date === today ? t('today') : fmtShort(e.date)}</div>
                  <div className="event-card__sub">{summary(e, scaleDefs?.catalog || [], b, f, t)}{e.notes ? ` · ${e.notes}` : ''}</div>
                </div>
                <Icon name="chevron" size={20} className="event-card__chevron" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
