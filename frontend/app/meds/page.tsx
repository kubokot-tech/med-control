'use client';

import { parseDecimal } from '../ui/decimal';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import Streak, { StreakLegend } from '../ui/Streak';
import BottomSheet from '../ui/BottomSheet';
import MedsCalendar from '../ui/MedsCalendar';
import { apiFetch } from '../ui/labUtils';
import { errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import { useEdition } from '../ui/edition';
import EmptyState from '../ui/EmptyState';

type MedItem = {
  id: string;
  medication: { id: string; name: string; form: string | null; strength: string | null; unit: string | null; role?: 'systemic' | 'support'; instructions?: string | null };
  remindAt?: string | null;
  timesPerDay?: number;
  doseValue: number | null;
  doseUnit: string | null;
  route: string | null;
  frequencyRule: string | null;
  scheduleDays?: number[] | null;
  intervalDays?: number | null;
  scheduleText?: string;
  dueToday?: boolean;
  nextDose?: string | null;
  timeWindows: { preferred?: string[] } | null;
  /** today's marks (GET /meds/regimens): a twice-a-day medication has a mark per dose */
  today?: { marks: { id: string; doseNo: number; status: string; takenAt: string | null }[]; taken: number; status: string | null };
};
type Regimen = { id: string; name: string; startDate: string; endDate: string | null; items: MedItem[] };
type Admin = { id: string; medicationId: string; doseNo?: number; takenAt: string | null; createdAt: string; day?: string; status: string; doseValue: number | null; doseUnit: string | null; notes: string | null; medName: string };
type Dose = { id: string; effectiveFrom: string; doseValue: number; doseUnit: string; reason: string | null };
type StreakData = {
  streak: { date: string; status: string | null }[];
  currentStreak: number;
  totalTaken: number;
  totalDays: number;
  missed?: number;
  today?: { date: string; status: string | null };
  regimenStart?: string | null;
  schedule?: { frequencyRule: string; text: string } | null;
};

const FREQ = ['DAILY', 'BID', 'TID', 'WEEKLY'] as const;
const isFreq = (s: string): s is typeof FREQ[number] => (FREQ as readonly string[]).includes(s);
const FORM = ['capsule', 'tablet'] as const;
const isForm = (s: string): s is typeof FORM[number] => (FORM as readonly string[]).includes(s);
const FREQ_OPTIONS = [['DAILY', 'daily'], ['WEEKLY', 'weekly'], ['EVERY_N_DAYS', 'everyNDays']] as const;

type Status = 'TAKEN' | 'SKIPPED' | 'MISSED' | 'PAUSED' | 'PARTIAL' | 'PLANNED';
const STATUS_PILL: Record<Status, string> = {
  TAKEN: 'ok',
  SKIPPED: 'low',
  MISSED: 'pill--danger',
  PAUSED: 'pill--info',
  PARTIAL: 'pill--info',
  PLANNED: '',
};
/** A plain daily schedule; the page words it itself (freq.DAILY). */
const isOnceDaily = (it: MedItem) => it.frequencyRule === 'DAILY' && (it.timesPerDay ?? 1) <= 1;
const isStatus = (s: string): s is Status => Object.prototype.hasOwnProperty.call(STATUS_PILL, s);
const pillOf = (s: string) => (isStatus(s) ? STATUS_PILL[s] : '');

export default function MedsPage() {
  const common = useTranslations('common');
  const num = (value: string) => parseDecimal(value, common('invalidNumber'));
  const t = useTranslations('meds');
  const f = useFormat();
  const ed = useEdition();
  const unitRu = (u: string | null | undefined) => (f.unit(u) || '').replace(/^mg$/i, t('units.mg')).replace(/^ml$/i, t('units.ml'));
  const statusLabel = (s: string) => (isStatus(s) ? t(`status.${s}`) : s);
  const fmtTime = (iso: string) => f.time(iso);
  const fmtDayWords = (iso: string) => f.date(iso, { day: 'numeric', month: 'long' });
  const [regimens, setRegimens] = useState<Regimen[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quiet, setQuiet] = useState(false); // quiet mode (gateway lib/homeHuman.js): no streak count after bad news
  const [showAll, setShowAll] = useState(false);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [doseOpen, setDoseOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [doseForm, setDoseForm] = useState({ value: '', date: '', reason: '' });
  const [supportStreaks, setSupportStreaks] = useState<Record<string, StreakData>>({});
  const [medOpen, setMedOpen] = useState<'new' | MedItem | null>(null);
  const [medForm, setMedForm] = useState({ name: '', role: 'support' as 'systemic' | 'support', doseValue: '', doseUnit: '', timesPerDay: '1', remindAt: '', instructions: '', startDate: '', freq: 'DAILY', days: [] as number[], interval: '2' });
  const [calMed, setCalMed] = useState<{ medicationId: string; regimenItemId?: string; start: string | null; schedule?: MedItem } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    apiFetch('/api/gateway/home/human').then((r) => (r.ok ? r.json() : null)).then((h) => setQuiet(Boolean(h?.quiet?.on))).catch(() => { /* optional */ });
    try {
      const [regR, adminR, streakR] = await Promise.all([
        apiFetch('/api/gateway/meds/regimens'),
        apiFetch('/api/gateway/meds/administrations'),
        apiFetch('/api/gateway/meds/streak?days=28'),
      ]);
      if (!regR.ok) throw new Error(await regR.text());
      if (!adminR.ok) throw new Error(await adminR.text());
      if (!streakR.ok) throw new Error(await streakR.text());
      const regs = (await regR.json()).regimens || [];
      setRegimens(regs);
      const supportItems = regs.flatMap((r: Regimen) => r.items).filter((it: MedItem) => it.medication.role !== 'systemic');
      const ss: Record<string, StreakData> = {};
      await Promise.all(supportItems.map(async (it: MedItem) => { const r = await apiFetch(`/api/gateway/meds/streak?days=14&medication_id=${it.medication.id}`); if (r.ok) ss[it.medication.id] = await r.json(); }));
      setSupportStreaks(ss);
      setAdmins((await adminR.json()).administrations || []);
      const st = await streakR.json();
      setStreak(st);
      const sysReg = regs.find((r: Regimen) => r.items.some((it: MedItem) => it.medication.role === 'systemic')) || regs[0];
      const itemId = sysReg?.items?.find((it: MedItem) => it.medication.role === 'systemic')?.id || sysReg?.items?.[0]?.id;
      if (itemId) {
        const dr = await apiFetch(`/api/gateway/meds/doses?regimen_item_id=${itemId}`);
        if (dr.ok) setDoses((await dr.json()).doses || []);
      }
      setDoseForm((f) => ({ ...f, date: f.date || st.today?.date || '' }));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const regimen = regimens.find((r) => r.items.some((it) => it.medication.role === 'systemic')) || regimens[0] || null;
  const item = regimen?.items?.find((it) => it.medication.role === 'systemic') || regimen?.items?.[0] || null;
  const med = item?.medication || null;
  const supportItems = regimens.flatMap((r) => r.items.map((it) => ({ ...it, regimenStart: r.startDate }))).filter((it) => it.id !== item?.id);
  const todayIso = streak?.today?.date;
  /** Today of one medication: its marks, how many doses a day, whether a dose is still open. */
  const dayOf = (it: MedItem | null | undefined) => {
    const marks = it?.today?.marks || [];
    const times = it?.timesPerDay || 1;
    const taken = marks.filter((m) => m.status === 'TAKEN');
    return { marks, times, taken: taken.length, last: marks[marks.length - 1] || null, open: times > 1 && marks.length > 0 && marks.length < times && !marks.some((m) => m.status === 'PAUSED'), at: taken.filter((m) => m.takenAt).map((m) => fmtTime(m.takenAt as string)).join(', ') };
  };

  async function recordFor(it: MedItem, status: 'TAKEN' | 'SKIPPED') {
    setActing(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/meds/administrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medication_id: it.medication.id, regimen_item_id: it.id, status, dose_value: it.doseValue ?? undefined, dose_unit: it.doseUnit ?? undefined }) });
      if (!r.ok && r.status !== 409) throw new Error(errorRu(await r.json().catch(() => ({}))));
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setActing(false); }
  }
  async function undoFor(id: string) {
    setActing(true);
    try { const r = await apiFetch(`/api/gateway/meds/administrations/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({})))); await load(); }
    catch (e: any) { setErr(String(e?.message || e)); } finally { setActing(false); }
  }
  function openMedNew() { setMedForm({ name: '', role: 'support', doseValue: '', doseUnit: '', timesPerDay: '1', remindAt: '08:00', instructions: '', startDate: todayIso || '', freq: 'DAILY', days: [], interval: '2' }); setMedOpen('new'); }
  function openMedEdit(it: MedItem) { setMedForm({ name: it.medication.name, role: it.medication.role || 'support', doseValue: it.doseValue != null ? String(it.doseValue) : '', doseUnit: it.doseUnit || '', timesPerDay: String(it.timesPerDay || 1), remindAt: it.remindAt || '', instructions: it.medication.instructions || '', startDate: '', freq: it.frequencyRule || 'DAILY', days: it.scheduleDays || [], interval: String(it.intervalDays || 2) }); setMedOpen(it); }
  function scheduleBody() {
    return { frequencyRule: medForm.freq, scheduleDays: medForm.freq === 'WEEKLY' ? medForm.days : null, intervalDays: medForm.freq === 'EVERY_N_DAYS' ? (num(medForm.interval) ?? 2) : null };
  }
  async function saveMed() {
    setActing(true); setErr(null);
    try {
      const r = medOpen === 'new'
        ? await apiFetch('/api/gateway/meds/medications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: medForm.name, role: medForm.role, doseValue: num(medForm.doseValue), doseUnit: medForm.doseUnit || null, timesPerDay: num(medForm.timesPerDay) ?? 1, remindAt: medForm.remindAt || null, instructions: medForm.instructions || null, startDate: medForm.startDate || undefined, ...scheduleBody() }) })
        : await apiFetch(`/api/gateway/meds/medications/${(medOpen as MedItem).medication.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: medForm.name, role: medForm.role, timesPerDay: num(medForm.timesPerDay) ?? 1, remindAt: medForm.remindAt || null, instructions: medForm.instructions || null, ...scheduleBody() }) });
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      setMedOpen(null); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setActing(false); }
  }
  async function stopMed(it: MedItem) {
    if (!confirm(t('stopConfirm', { name: it.medication.name }))) return;
    setActing(true); setErr(null);
    try { const r = await apiFetch(`/api/gateway/meds/medications/${it.medication.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stop: true }) }); if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({})))); setMedOpen(null); await load(); }
    catch (e: any) { setErr(String(e?.message || e)); } finally { setActing(false); }
  }
  const heroDay = dayOf(item);
  const todayStatus = item?.today ? item.today.status : streak?.today?.status ?? null;
  const todayRecord = heroDay.last;

  async function record(status: 'TAKEN' | 'SKIPPED') {
    if (!med || !item) return;
    setActing(true);
    setErr(null);
    try {
      const r = await apiFetch('/api/gateway/meds/administrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medication_id: med.id, regimen_item_id: item.id, status, dose_value: item.doseValue ?? undefined, dose_unit: item.doseUnit ?? undefined }),
      });
      if (!r.ok && r.status !== 409) throw new Error(await r.text());
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setActing(false);
    }
  }
  async function saveDose() {
    if (!item) return;

    setActing(true);
    setErr(null);
    try {
      const value = num(doseForm.value);
      if (value === null || value <= 0 || !doseForm.date) throw new Error(t('dose.required'));
      const r = await apiFetch('/api/gateway/meds/doses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regimen_item_id: item.id, effective_from: doseForm.date, dose_value: value, dose_unit: item.doseUnit || 'mg', reason: doseForm.reason || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDoseOpen(false);
      setDoseForm({ value: '', date: streak?.today?.date || '', reason: '' });
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setActing(false);
    }
  }

  async function undo() {
    if (!todayRecord) return;
    setActing(true);
    try {
      const r = await apiFetch(`/api/gateway/meds/administrations/${todayRecord.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setActing(false);
    }
  }

  const dose = item?.doseValue ? `${f.number(item.doseValue)} ${unitRu(item.doseUnit)}` : '';
  const form = med?.form ? (isForm(med.form) ? t(`dosageForm.${med.form}`) : med.form) : '';
  const freq = item?.scheduleText ? (isOnceDaily(item) ? t('freq.DAILY') : item.scheduleText) : item?.frequencyRule ? (isFreq(item.frequencyRule) ? t(`freq.${item.frequencyRule}`) : item.frequencyRule) : '';
  const window = item?.timeWindows?.preferred?.[0]?.replace('-', '–');
  const details = [dose, form, freq && (window ? `${freq}, ${window}` : freq), regimen?.startDate ? t('since', { date: fmtDayWords(regimen.startDate), year: new Date(regimen.startDate).getFullYear() }) : ''].filter(Boolean).join(' · ');

  const pct = streak && streak.totalDays ? Math.round((streak.totalTaken / streak.totalDays) * 100) : 0;
  const journal = showAll ? admins : admins.slice(0, 14);

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><h1 className="page-header__title">{t('title')}</h1><p className="page-header__desc">{t('desc')}</p></div>
        <button type="button" className="btn btn--secondary" onClick={openMedNew}><Icon name="plus" size={18} />{t('add')}</button>
      </div>

      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}
      {loading && !med && <div className="skeleton skeleton--card" />}

      {!loading && !med && (
        <EmptyState icon="meds" title={t('empty.title')} description={t('empty.desc')} />
      )}

      {med && item && (
        <div className="meds-grid">
          <div className="card meds-card">
            <div className="meds-card__head">
              <div className="event-card__icon event-card__icon--meds"><Icon name="meds" size={24} /></div>
              <div className="event-card__body">
                <div className="meds-card__name">{med.name}</div>
                <div className="event-card__sub">{details}</div>
              </div>
              <span className="pill ok">{t('hero.mainPill')}</span>
            </div>
            {med.instructions && <div className="muted" style={{ fontSize: 14 }}>{med.instructions}</div>}

            {heroDay.open ? (
              <>
                <div className="muted" style={{ fontSize: 14 }}>{heroDay.at ? t('hero.markedOfAt', { marked: heroDay.marks.length, times: heroDay.times, at: heroDay.at }) : t('hero.markedOf', { marked: heroDay.marks.length, times: heroDay.times })}</div>
                <button type="button" className="btn btn--primary btn--lg btn--block btn--dose" onClick={() => record('TAKEN')} disabled={acting}>
                  <Icon name="check" strokeWidth={2.2} />{acting ? t('saving') : t('hero.takeNth', { n: heroDay.marks.length + 1 })}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn--secondary btn--block" onClick={() => record('SKIPPED')} disabled={acting}>{t('skip')}</button>
                  <button type="button" className="btn btn--ghost btn--block" onClick={undo} disabled={acting}>{t('undoLast')}</button>
                </div>
              </>
            ) : todayStatus ? (
              <>
                <div className={`btn btn--lg btn--block ${todayStatus === 'TAKEN' || todayStatus === 'PARTIAL' ? 'btn--soft' : 'btn--secondary'}`} style={{ cursor: 'default' }}>
                  <Icon name="check" strokeWidth={2.2} />
                  {heroDay.times > 1 && heroDay.taken > 0 && todayStatus !== 'PAUSED'
                    ? (heroDay.at ? t('hero.takenOfAt', { taken: heroDay.taken, times: heroDay.times, at: heroDay.at }) : t('hero.takenOf', { taken: heroDay.taken, times: heroDay.times }))
                    : todayStatus === 'TAKEN' ? (todayRecord?.takenAt ? t('hero.takenTodayAt', { time: fmtTime(todayRecord.takenAt) }) : t('hero.takenToday')) : todayStatus === 'PAUSED' ? t('hero.paused') : todayStatus === 'SKIPPED' ? t('hero.skipped') : t('hero.todayStatus', { status: statusLabel(todayStatus) })}
                </div>
                {todayRecord && <button type="button" className="btn btn--ghost" onClick={undo} disabled={acting}>{t('undoMark')}</button>}
              </>
            ) : (
              <>
                {item?.dueToday === false && <div className="muted" style={{ fontSize: 14 }}>{item.nextDose ? t('hero.notDueNext', { schedule: item.scheduleText ?? '', date: fmtDayWords(item.nextDose) }) : t('hero.notDue', { schedule: item.scheduleText ?? '' })}</div>}
                <button type="button" className={`btn ${item?.dueToday === false ? 'btn--secondary' : 'btn--primary'} btn--lg btn--block btn--dose`} onClick={() => record('TAKEN')} disabled={acting}>
                  <Icon name="check" strokeWidth={2.2} />{acting ? t('saving') : heroDay.times > 1 ? t('hero.takeFirst') : t('takeToday')}
                </button>
                <button type="button" className="btn btn--secondary btn--block" onClick={() => record('SKIPPED')} disabled={acting}>{t('skip')}</button>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => setCalOpen(true)}>{t('calendarButton')}</button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setDoseOpen(true)}>{t('dose.change')}</button>
            </div>
            {doses.length > 0 && (
              <div className="dose-history">
                <div className="section-label">{t('dose.history')}</div>
                {doses.map((d) => (
                  <div key={d.id} className="dose-history__row">
                    <span className="muted">{fmtDayWords(d.effectiveFrom + 'T12:00:00Z')} {new Date(d.effectiveFrom + 'T12:00:00Z').getFullYear()}</span>
                    <span style={{ fontWeight: 600 }}>{f.number(d.doseValue)} {unitRu(d.doseUnit)}</span>
                    <span className="muted" style={{ flexBasis: '100%' }}>{d.reason || ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {streak && (
            <div className="card meds-card">
              <div className="meds-card__row">
                <div className="card__title">{t('streak.title')}</div>
                <div className="muted">{t('streak.stats', { taken: streak.totalTaken, total: streak.totalDays, pct })}</div>
              </div>
              <div className="meds-streak">
                <Streak days={streak.streak} />
                <StreakLegend />
              </div>
              {!quiet && streak.currentStreak > 0 && <div className="meds-card__streak">{streak.schedule && streak.schedule.frequencyRule !== 'DAILY' ? t('streak.dosesInRow', { n: streak.currentStreak }) : t('streak.daysInRow', { n: streak.currentStreak })}</div>}
            </div>
          )}
        </div>
      )}

      {supportItems.length > 0 && todayIso && (
        <div className="today-section" style={{ marginTop: 20 }}>
          <div className="section-label">{t('support.title', { n: supportItems.length })}</div>
          {supportItems.map((it) => {
            const day = dayOf(it);
            const rec = day.last;
            const st = supportStreaks[it.medication.id];
            const d = it.doseValue != null ? `${f.number(it.doseValue)} ${unitRu(it.doseUnit)}` : '';
            return (
              <div key={it.id} className="card meds-card" style={{ gap: 8 }}>
                <div className="meds-card__head">
                  <div className="event-card__icon event-card__icon--other"><Icon name="meds" size={22} /></div>
                  <div className="event-card__body">
                    <div className="meds-card__name" style={{ fontSize: 17 }}>{it.medication.name}</div>
                    <div className="event-card__sub">{[d, !it.scheduleText || isOnceDaily(it) ? t('freq.DAILY') : it.scheduleText, it.remindAt ? t('support.remindAt', { time: it.remindAt }) : t('support.noRemind'), it.regimenStart ? t('since', { date: fmtDayWords(it.regimenStart), year: new Date(it.regimenStart).getFullYear() }) : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openMedEdit(it)}>{t('edit')}</button>
                </div>
                {it.medication.instructions && <div className="muted" style={{ fontSize: 14 }}>{it.medication.instructions}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {rec && day.times > 1
                    ? <><span className={`pill ${day.open ? 'pill--info' : pillOf(it.today?.status || '')}`}>{day.at ? t('support.todayOfAt', { taken: day.taken, times: day.times, at: day.at }) : t('support.todayOf', { taken: day.taken, times: day.times })}</span>{day.open && <><button type="button" className="btn btn--primary btn--sm" onClick={() => recordFor(it, 'TAKEN')} disabled={acting}><Icon name="check" strokeWidth={2.2} />{t('support.takeNth', { n: day.marks.length + 1 })}</button><button type="button" className="btn btn--secondary btn--sm" onClick={() => recordFor(it, 'SKIPPED')} disabled={acting}>{t('skip')}</button></>}<button type="button" className="btn btn--ghost btn--sm" onClick={() => undoFor(rec.id)} disabled={acting}>{t('undoLast')}</button></>
                    : rec
                    ? <><span className={`pill ${pillOf(rec.status)}`}>{rec.takenAt && rec.status === 'TAKEN' ? t('support.todayStatusAt', { status: statusLabel(rec.status).toLowerCase(), time: fmtTime(rec.takenAt) }) : t('support.todayStatus', { status: statusLabel(rec.status).toLowerCase() })}</span><button type="button" className="btn btn--ghost btn--sm" onClick={() => undoFor(rec.id)} disabled={acting}>{t('undo')}</button></>
                    : <>{it.dueToday === false && <span className="muted" style={{ fontSize: 13 }}>{it.nextDose ? t('support.notDueNext', { date: fmtDayWords(it.nextDose) }) : t('support.notDue')}</span>}<button type="button" className={`btn ${it.dueToday === false ? 'btn--secondary' : 'btn--primary'} btn--sm`} onClick={() => recordFor(it, 'TAKEN')} disabled={acting}><Icon name="check" strokeWidth={2.2} />{day.times > 1 ? t('support.takeFirst') : t('takeToday')}</button><button type="button" className="btn btn--secondary btn--sm" onClick={() => recordFor(it, 'SKIPPED')} disabled={acting}>{t('skip')}</button></>}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCalMed({ medicationId: it.medication.id, regimenItemId: it.id, start: it.regimenStart || null, schedule: it })}>{t('calendarButton')}</button>
                </div>
                {st && <div className="meds-streak"><Streak days={st.streak} compact /><span className="muted" style={{ fontSize: 13 }}>{it.scheduleText && !isOnceDaily(it) ? t('support.statsSchedule', { taken: st.totalTaken, total: st.totalDays }) : t('support.stats', { taken: st.totalTaken, total: st.totalDays })}</span></div>}
              </div>
            );
          })}
        </div>
      )}

      {med && streak?.today?.date && (
        <MedsCalendar open={calOpen} onClose={() => setCalOpen(false)} medicationId={med.id} regimenItemId={item?.id} regimenStart={streak?.regimenStart || regimen?.startDate || null} today={streak.today.date} onChanged={load} schedule={item} />
      )}
      {calMed && todayIso && (
        <MedsCalendar open={true} onClose={() => setCalMed(null)} medicationId={calMed.medicationId} regimenItemId={calMed.regimenItemId} regimenStart={calMed.start} today={todayIso} onChanged={load} schedule={calMed.schedule} />
      )}
      <BottomSheet error={err} open={medOpen !== null} onClose={() => setMedOpen(null)} title={medOpen === 'new' ? t('medForm.titleNew') : t('medForm.title')}>
        <div className="sheet__block">
          <label className="field"><span>{t('medForm.name')}</span><input value={medForm.name} onChange={(e) => setMedForm({ ...medForm, name: e.target.value })} placeholder={t('medForm.namePlaceholder')} maxLength={120} /></label>
          <div className="section-label">{t('medForm.role')}</div>
          <div className="seg">
            <button type="button" className={`seg__btn ${medForm.role === 'support' ? 'seg__btn--active' : ''}`} onClick={() => setMedForm({ ...medForm, role: 'support' })}>{t('medForm.roleSupport')}</button>
            <button type="button" className={`seg__btn ${medForm.role === 'systemic' ? 'seg__btn--active' : ''}`} onClick={() => setMedForm({ ...medForm, role: 'systemic' })}>{t('medForm.roleSystemic')}</button>
          </div>
          {medOpen === 'new' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label className="field"><span>{t('medForm.dose')}</span><input inputMode="decimal" value={medForm.doseValue} onChange={(e) => setMedForm({ ...medForm, doseValue: e.target.value })} placeholder="125" /></label>
              <label className="field"><span>{t('medForm.unit')}</span><input value={medForm.doseUnit} onChange={(e) => setMedForm({ ...medForm, doseUnit: e.target.value })} placeholder={t('medForm.unitPlaceholder')} /></label>
              <label className="field"><span>{t('medForm.startDate')}</span><input type="date" value={medForm.startDate} max={todayIso} onChange={(e) => setMedForm({ ...medForm, startDate: e.target.value })} /></label>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field"><span>{t('medForm.timesPerDay')}</span><input inputMode="numeric" value={medForm.timesPerDay} onChange={(e) => setMedForm({ ...medForm, timesPerDay: e.target.value })} /></label>
            <label className="field"><span>{t(ed.available('telegram') ? 'medForm.remindAt' : 'medForm.remindAtDevice')}</span><input type="time" value={medForm.remindAt} onChange={(e) => setMedForm({ ...medForm, remindAt: e.target.value })} /></label>
          </div>
          <div className="field">
            <span>{t('medForm.howOften')}</span>
            <div className="seg">
              {FREQ_OPTIONS.map(([v, l]) => (
                <button key={v} type="button" className={`seg__btn ${medForm.freq === v ? 'seg__btn--active' : ''}`} onClick={() => setMedForm({ ...medForm, freq: v })}>{t(`medForm.freqOptions.${l}`)}</button>
              ))}
            </div>
            {medForm.freq === 'WEEKLY' && (
              <div className="seg" style={{ marginTop: 6 }}>
                {f.weekdays().map(([d, l]) => (
                  <button key={d} type="button" className={`seg__btn ${medForm.days.includes(d) ? 'seg__btn--active' : ''}`} onClick={() => setMedForm({ ...medForm, days: medForm.days.includes(d) ? medForm.days.filter((x) => x !== d) : [...medForm.days, d].sort() })}>{l}</button>
                ))}
              </div>
            )}
            {medForm.freq === 'WEEKLY' && !medForm.days.length && <span className="muted" style={{ fontSize: 13 }}>{t('medForm.noDaysHint')}</span>}
            {medForm.freq === 'EVERY_N_DAYS' && (
              <label className="field" style={{ marginTop: 6, maxWidth: 200 }}><span>{t('medForm.interval')}</span><input inputMode="numeric" value={medForm.interval} onChange={(e) => setMedForm({ ...medForm, interval: e.target.value })} /></label>
            )}
          </div>
          <label className="field"><span>{t('medForm.instructions')}</span><textarea rows={3} value={medForm.instructions} onChange={(e) => setMedForm({ ...medForm, instructions: e.target.value })} placeholder={t('medForm.instructionsPlaceholder')} /></label>
          <div className="muted" style={{ fontSize: 13 }}>{t('medForm.note')}</div>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={saveMed} disabled={acting || !medForm.name.trim()}><Icon name="check" strokeWidth={2.2} />{t('save')}</button>
          {medOpen !== 'new' && medOpen && <button type="button" className="btn btn--ghost" onClick={() => stopMed(medOpen)} disabled={acting}>{t('medForm.stop')}</button>}
        </div>
      </BottomSheet>
      <BottomSheet error={err} open={doseOpen} onClose={() => setDoseOpen(false)} title={t('dose.change')}>
        <div className="sheet__block">
          <div className="muted">{t('dose.current', { dose: dose || '—' })}</div>
          <label className="field"><span>{t('dose.newLabel', { unit: unitRu(item?.doseUnit) || t('units.mg') })}</span><input inputMode="decimal" placeholder="20" value={doseForm.value} onChange={(e) => setDoseForm({ ...doseForm, value: e.target.value })} /></label>
          <label className="field"><span>{t('dose.fromDay')}</span><input type="date" value={doseForm.date} max={streak?.today?.date} onChange={(e) => setDoseForm({ ...doseForm, date: e.target.value })} /></label>
          <label className="field"><span>{t('dose.reason')}</span><input placeholder={t('dose.reasonPlaceholder')} value={doseForm.reason} onChange={(e) => setDoseForm({ ...doseForm, reason: e.target.value })} /></label>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={saveDose} disabled={acting}>{t('save')}</button>
        </div>
      </BottomSheet>

      {med && (
        <div className="today-section" style={{ marginTop: 20 }}>
          <div className="section-label">{t('journal.title')}</div>
          {admins.length === 0 && !loading && (
            <div className="card coming-soon" style={{ minHeight: 160 }}>
              <div className="coming-soon__desc">{t('journal.empty')}</div>
            </div>
          )}
          {journal.map((a) => {
            const st = { label: statusLabel(a.status), pill: pillOf(a.status) };
            const at = a.takenAt || a.createdAt;
            return (
              <div key={a.id} className="event-card">
                <div className={`event-card__icon ${a.status === 'TAKEN' ? 'event-card__icon--meds' : 'event-card__icon--other'}`}><Icon name={a.status === 'TAKEN' ? 'check' : 'close'} size={22} /></div>
                <div className="event-card__body">
                  <div className="event-card__title">{st.label} · {fmtDayWords(at)}</div>
                  <div className="event-card__sub">
                    {a.takenAt ? fmtTime(a.takenAt) : ''}{a.doseValue ? ` · ${a.doseValue} ${unitRu(a.doseUnit)}` : ''}{a.notes ? ` · ${a.notes}` : ''}
                  </div>
                </div>
                <span className={`pill ${st.pill}`}>{st.label.toLowerCase()}</span>
              </div>
            );
          })}
          {admins.length > journal.length && (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setShowAll(true)}>{t('journal.showAll', { n: admins.length })}</button>
          )}
        </div>
      )}
    </div>
  );
}
