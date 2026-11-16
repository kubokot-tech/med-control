'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './ui/icons';
import EventCard, { dayHeading, fmtDayLong, fmtWeekday, type FeedItem } from './ui/EventCard';
import AlertCard, { type Alert } from './ui/AlertCard';
import { apiFetch, flagFor, refText } from './ui/labUtils';
import { todayKey as todayKeyTz } from './ui/api';
import { useFormat } from './ui/format';
import SetupChecklist from './ui/SetupChecklist';
import { Greeting, MoodCard, GoodNews, Moments, QuietNote, type Addressee, type HomeHuman } from './ui/TodayHuman';
import { Avatar } from './ui/Avatar';
import EmptyState from './ui/EmptyState';

type Regimen = { id: string; startDate: string; items: { id: string; medication: { id: string; name: string }; doseValue: number | null; doseUnit: string; timeWindows: any; scheduleText?: string; dueToday?: boolean; nextDose?: string | null; timesPerDay?: number; today?: DoseDay }[] };
/** Today's dose marks of a medication (GET /meds/regimens): twice a day has a mark per dose. */
type DoseDay = { marks: { id: string; doseNo: number; status: string; takenAt: string | null }[]; taken: number; status: string | null };
type Admin = { id: string; medicationId: string; takenAt: string; createdAt: string; status: string };
type Streak = { streak: { date: string; status: string | null }[]; currentStreak: number; missed?: number; today?: { date: string; status: string | null }; regimenStart?: string | null; schedule?: { frequencyRule: string; text: string } | null };
type Card = { key: string; short?: string; name?: string; last: { valueNum: number | null; valueText: string | null; unit: string | null; refLow: number | null; refHigh: number | null; date: string } | null };

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

type Appt = { id: string; date: string; time: string | null; doctor: string | null; place: string | null; questions: string | null };
const apptDays = (a: string, b: string) => Math.round((new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86400000);

export default function TodayPage() {
  const t = useTranslations('home');
  const f = useFormat();
  const fmtTime = (iso: string) => f.time(iso);
  const fmtNum = (n: number) => f.number(n, { maximumFractionDigits: 2 });
  const apptDate = (d: string) => f.date(d, { day: 'numeric', month: 'long' });
  const [regimen, setRegimen] = useState<Regimen | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [recent, setRecent] = useState<Admin[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [appt, setAppt] = useState<{ next: Appt | null; overdue: Appt[]; today: string } | null>(null);
  const [who, setWho] = useState<Addressee | null>(null);
  const [wellbeing, setWellbeing] = useState<number | null>(null);
  const [human, setHuman] = useState<HomeHuman | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [regR, streakR, adminR, ovR, feedR, alR, apR] = await Promise.all([
        apiFetch('/api/gateway/meds/regimens'),
        apiFetch('/api/gateway/meds/streak?days=7'),
        apiFetch('/api/gateway/meds/administrations'),
        apiFetch('/api/gateway/labs/overview'),
        apiFetch('/api/gateway/timeline?limit=30'),
        apiFetch('/api/gateway/alerts'),
        apiFetch('/api/gateway/appointments'),
      ]);
      // the friendlier parts of the screen: never block the rest
      Promise.all([
        apiFetch('/api/gateway/settings/patient').then((r) => (r.ok ? r.json() : null)),
        apiFetch(`/api/gateway/symptoms/${todayKeyTz()}`).then((r) => (r.ok ? r.json() : null)),
        apiFetch('/api/gateway/home/human').then((r) => (r.ok ? r.json() : null)),
      ]).then(([p, s, h]) => {
        if (p) setWho({ callName: p.callName || '', keptBy: p.keptBy === 'relative' ? 'relative' : 'self', name: p.name || '', photo: p.photo || '' });
        setWellbeing(s?.entry?.wellbeing ?? null);
        setHuman(h);
      }).catch(() => { /* optional */ });
      if (alR.ok) setAlerts((await alR.json()).alerts || []);
      if (apR.ok) { const ap = await apR.json(); setAppt({ next: ap.next, overdue: ap.overdue || [], today: ap.today }); }
      if (regR.ok) setRegimen(((await regR.json()).regimens || [])[0] || null);
      if (streakR.ok) setStreak(await streakR.json());
      if (adminR.ok) setRecent(((await adminR.json()).administrations || []).slice(0, 10));
      if (ovR.ok) setCards((await ovR.json()).cards || []);
      if (!feedR.ok) throw new Error(await feedR.text());
      const feed = await feedR.json();
      setItems(feed.items || []);
      setCursor(feed.nextCursor || null);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resumeMoments() {
    const r = await apiFetch('/api/gateway/home/quiet/resume', { method: 'POST' });
    if (r.ok) setHuman(await r.json());
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await apiFetch(`/api/gateway/timeline?limit=30&cursor=${encodeURIComponent(cursor)}`);
      if (!r.ok) throw new Error(await r.text());
      const feed = await r.json();
      setItems((prev) => [...prev, ...(feed.items || [])]);
      setCursor(feed.nextCursor || null);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingMore(false);
    }
  }

  const item = regimen?.items?.[0] || null;
  const med = item?.medication || null;
  const todayKey = streak?.today?.date || todayKeyTz();
  const yesterdayKey = useMemo(() => {
    const d = new Date(todayKey + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10);
  }, [todayKey]);
  // several doses a day: the day is done only when every dose is marked (PARTIAL until then)
  const times = item?.timesPerDay || 1;
  const marks = item?.today?.marks || [];
  const todayStatus = item?.today ? item.today.status : streak?.today?.status ?? null;
  const lastMark = marks[marks.length - 1] || null;
  const todayRecord = lastMark ? { id: lastMark.id, takenAt: lastMark.takenAt || '' } : null;
  const takenTimes = marks.filter((m) => m.status === 'TAKEN' && m.takenAt).map((m) => fmtTime(m.takenAt as string)).join(', ');
  const yesterdayRecord = recent.find((a) => a.medicationId === med?.id && a.status === 'TAKEN' && a.takenAt && ((a as any).day || a.takenAt.slice(0, 10)) === yesterdayKey);
  const therapyDay = streak?.regimenStart ? daysBetween(streak.regimenStart, todayKey) + 1 : null;
  const window = item?.timeWindows?.preferred?.[0] as string | undefined;

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

  // Attention: markers outside the reference range on their latest value + missed doses this week
  const alertKeys = new Set(alerts.map((a) => a.key));
  const attention = cards
    .map((c) => ({ c, flag: flagFor(c.last?.valueNum, c.last?.refLow, c.last?.refHigh) }))
    .filter((x) => (x.flag === 'high' || x.flag === 'low') && !alertKeys.has(x.c.key));
  const missedWeek = streak?.missed ?? 0;

  async function ack(a: Alert) {
    const r = await apiFetch(`/api/gateway/alerts/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACK' }) });
    if (r.ok) setAlerts((prev) => prev.filter((x) => x.id !== a.id));
  }

  // Group feed by day
  const groups = useMemo(() => {
    const out: { day: string; items: FeedItem[] }[] = [];
    for (const it of items) {
      const g = out[out.length - 1];
      if (g && g.day === it.day) g.items.push(it); else out.push({ day: it.day, items: [it] });
    }
    return out;
  }, [items]);

  const unit = (f.unit(item?.doseUnit) || '').replace(/^mg$/i, t('dose.mg')).replace(/^ml$/i, t('dose.ml'));
  const doseLabel = med ? `${med.name}${item?.doseValue ? ` ${fmtNum(item.doseValue)} ${unit}` : ''}`.trim() : '';

  return (
    <div className="page-container">
      <div className="today-grid">
        <div className="today-col">
          <div className="today-head">
            <div>
              <Greeting who={who} />
              <h1 className="page-header__title">{fmtWeekday(f, todayKey)}, {fmtDayLong(f, todayKey)}</h1>
              <div className="page-header__desc">
                {therapyDay ? t('header.therapyDay', { day: therapyDay }) : t('header.therapy')}
                {streak && streak.currentStreak > 0 && !human?.quiet.on ? (streak.schedule && streak.schedule.frequencyRule !== 'DAILY' ? ` · ${t('header.streakSchedule', { n: streak.currentStreak })}` : ` · ${t('header.streakDaily', { n: streak.currentStreak })}`) : ''}
              </div>
            </div>
            {who && <Avatar who={who} size={52} />}
          </div>

          {err && <div className="msg msg--error">{err}</div>}

          <SetupChecklist />

          {med && (
            <div className="today-dose">
              {times > 1 && marks.length > 0 && marks.length < times && todayStatus !== 'PAUSED' ? (
                <>
                  <button type="button" className="btn btn--primary btn--lg btn--block btn--dose" onClick={() => record('TAKEN')} disabled={acting}>
                    <Icon name="check" strokeWidth={2.2} />
                    {acting ? t('dose.saving') : t('dose.takeNth', { n: marks.length + 1, dose: doseLabel })}
                  </button>
                  <div className="today-dose__hint">
                    {takenTimes ? t('dose.markedAt', { n: marks.length, total: times, times: takenTimes }) : t('dose.marked', { n: marks.length, total: times })}
                    <button type="button" className="btn btn--ghost btn--sm" onClick={undo} disabled={acting}>{t('dose.undoLast')}</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => record('SKIPPED')} disabled={acting}>{t('dose.skip')}</button>
                  </div>
                </>
              ) : todayStatus ? (
                <>
                  <div className={`btn btn--lg btn--block ${todayStatus === 'TAKEN' || todayStatus === 'PARTIAL' ? 'btn--soft' : 'btn--secondary'}`} style={{ cursor: 'default' }}>
                    <Icon name="check" strokeWidth={2.2} />
                    {times > 1 && todayStatus !== 'PAUSED' && marks.some((m) => m.status === 'TAKEN')
                      ? (takenTimes ? t('dose.takenOfAt', { n: item?.today?.taken ?? 0, total: times, times: takenTimes }) : t('dose.takenOf', { n: item?.today?.taken ?? 0, total: times }))
                      : todayStatus === 'TAKEN' ? (todayRecord?.takenAt ? t('dose.takenAt', { time: fmtTime(todayRecord.takenAt) }) : t('dose.taken')) : todayStatus === 'PAUSED' ? t('dose.paused') : t('dose.skipped')}
                  </div>
                  <div className="today-dose__hint">
                    {doseLabel}
                    {todayRecord && <button type="button" className="btn btn--ghost btn--sm" onClick={undo} disabled={acting}>{t('dose.undo')}</button>}
                  </div>
                </>
              ) : item?.dueToday === false ? (
                <>
                  <div className="btn btn--lg btn--block btn--soft" style={{ cursor: 'default' }}>
                    {item.nextDose ? t('dose.notDueNext', { date: fmtDayLong(f, item.nextDose) }) : t('dose.notDue')}
                  </div>
                  <div className="today-dose__hint">
                    {doseLabel}{item.scheduleText ? ` · ${item.scheduleText}` : ''}
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => record('TAKEN')} disabled={acting}>{t('dose.offSchedule')}</button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn--primary btn--lg btn--block btn--dose" onClick={() => record('TAKEN')} disabled={acting}>
                    <Icon name="check" strokeWidth={2.2} />
                    {acting ? t('dose.saving') : times > 1 ? t('dose.takeNth', { n: 1, dose: doseLabel }) : t('dose.take', { dose: doseLabel })}
                  </button>
                  <div className="today-dose__hint">
                    {window ? t('dose.usually', { window: window.replace('-', '–') }) : ''}
                    {yesterdayRecord ? `${window ? ' · ' : ''}${t('dose.yesterday', { time: fmtTime(yesterdayRecord.takenAt) })}` : ''}
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => record('SKIPPED')} disabled={acting}>{t('dose.skip')}</button>
                  </div>
                </>
              )}
            </div>
          )}

          {!loading && <MoodCard who={who} day={todayKey} value={wellbeing} onSaved={setWellbeing} />}
          <Moments items={human?.moments || []} />
          <GoodNews items={human?.goodNews || []} />
          {human && <QuietNote quiet={human.quiet} onResume={resumeMoments} />}

          {appt && (appt.next || appt.overdue.length > 0) && (
              <div className="today-section">
                {appt.overdue.map((a) => (
                  <Link key={a.id} href="/consults" className="card meds-card appt-next">
                    <div className="event-card__icon event-card__icon--other"><Icon name="consult" size={22} /></div>
                    <div className="event-card__body">
                      <div className="ms-card__title">{t('appt.overdue', { date: apptDate(a.date) })}</div>
                      <div className="event-card__sub">{t('appt.overdueHint')}</div>
                    </div>
                    <Icon name="chevron" size={20} className="event-card__chevron" />
                  </Link>
                ))}
                {appt.next && (() => { const d = apptDays(appt.next.date, appt.today); return (
                  <Link href="/consults" className="card meds-card appt-next">
                    <div className="event-card__icon event-card__icon--other"><Icon name="consult" size={22} /></div>
                    <div className="event-card__body">
                      <div className="ms-card__title">{appt.next.time
                        ? t('appt.nextAt', { d, doctor: appt.next.doctor || t('appt.doctor'), date: apptDate(appt.next.date), time: f.clock(appt.next.time) })
                        : t('appt.next', { d, doctor: appt.next.doctor || t('appt.doctor'), date: apptDate(appt.next.date) })}</div>
                      <div className="event-card__sub">{appt.next.questions ? t('appt.questionsReady') : t('appt.questionsMissing')}</div>
                    </div>
                    <Icon name="chevron" size={20} className="event-card__chevron" />
                  </Link>
                ); })()}
              </div>
            )}


          {(alerts.length > 0 || attention.length > 0 || missedWeek > 0) && (
            <div className="today-section">
              <div className="section-label">{t('attention.title')}</div>
              {alerts.map((a) => <AlertCard key={a.id} alert={a} onAck={ack} compact />)}
              {attention.map(({ c, flag }) => (
                <Link key={c.key} href={`/labs/series?key=${encodeURIComponent(c.key)}`} className="attention-card">
                  <Icon name="warn" />
                  <div className="event-card__body">
                    <div className="attention-card__title">
                      {t(flag === 'high' ? 'attention.high' : 'attention.low', { name: c.short || c.key, value: c.last?.valueText ?? '' })}
                    </div>
                    <div className="attention-card__sub">
                      {c.last?.unit
                        ? t('attention.refUnit', { range: refText(f, c.last?.refLow, c.last?.refHigh) || '—', unit: c.last.unit, date: c.last?.date ? f.date(c.last.date, { day: 'numeric', month: 'long' }) : '—' })
                        : t('attention.ref', { range: refText(f, c.last?.refLow, c.last?.refHigh) || '—', date: c.last?.date ? f.date(c.last.date, { day: 'numeric', month: 'long' }) : '—' })}
                    </div>
                  </div>
                  <Icon name="chevron" size={20} className="event-card__chevron" />
                </Link>
              ))}
              {missedWeek > 0 && (
                <Link href="/meds" className="attention-card">
                  <Icon name="warn" />
                  <div className="event-card__body">
                    <div className="attention-card__title">{t('attention.missed')}</div>
                    <div className="attention-card__sub">{t('attention.missedSub', { n: missedWeek })}</div>
                  </div>
                  <Icon name="chevron" size={20} className="event-card__chevron" />
                </Link>
              )}
            </div>
          )}

          <div className="today-actions">
            <Link href="/labs/upload" className="btn btn--secondary"><Icon name="upload" />{t('actions.upload')}</Link>
            <Link href="/labs" className="btn btn--secondary"><Icon name="labs" />{t('actions.summary')}</Link>
          </div>
        </div>

        <div className="today-col today-feed">
          {loading && items.length === 0 && (
            <>
              <div className="skeleton" style={{ height: 76 }} />
              <div className="skeleton" style={{ height: 76 }} />
              <div className="skeleton" style={{ height: 76 }} />
            </>
          )}
          {!loading && items.length === 0 && (
            <EmptyState icon="today" title={t('feed.empty')} description={t('feed.emptyDesc')} action={<Link href="/labs/upload" className="btn btn--primary"><Icon name="upload" />{t('actions.upload')}</Link>} />
          )}
          {groups.map((g) => (
            <div key={g.day} className="today-section">
              <div className="section-label">{dayHeading(f, g.day, todayKey, yesterdayKey)}</div>
              {g.items.map((it) => <EventCard key={it.id} item={it} />)}
            </div>
          ))}
          {cursor && (
            <button type="button" className="btn btn--secondary btn--block" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t('feed.loading') : t('feed.more')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
