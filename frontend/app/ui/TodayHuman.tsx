'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { useFormat } from './format';

/** How the home screen addresses the patient (Settings → patient): GET /settings/patient. */
export type Addressee = { callName: string; keptBy: 'self' | 'relative'; name: string; photo: string };
/** GET /home/human (gateway lib/homeHuman.js): good news, quiet milestones, quiet mode. */
export type GoodNewsItem =
  | { id: string; kind: 'milestone'; date: string; title: string; milestoneId: string }
  | { id: string; kind: 'labNormal'; date: string; key: string; short: string; was: 'high' | 'low' };

export type Moment = { id: string; kind: 'therapyDays' | 'therapyYears' | 'streakDays' | 'streakDoses'; n: number; date: string };
export type Quiet = { on: boolean; reason: 'setting' | 'badNews' | null; milestoneId: string | null };
export type HomeHuman = { goodNews: GoodNewsItem[]; moments: Moment[]; quiet: Quiet };

const partOfDay = (h: number | null) => (h == null ? 'day' : h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : h < 23 ? 'evening' : 'night');

/** Good evening and the patient's name above the date; for someone keeping a relative's diary, just the greeting. */
export function Greeting({ who }: { who: Addressee | null }) {
  const t = useTranslations('home');
  const f = useFormat();
  const part = partOfDay(f.hour());
  const name = who?.keptBy === 'self' ? who.callName.trim() : '';
  return <div className="today-greeting">{name ? t('human.greetName', { part, name }) : t('human.greet', { part })}</div>;
}

const LEVELS = [1, 2, 3, 4, 5] as const;
const LEVEL_KEY = { 1: 'bad', 2: 'meh', 3: 'ok', 4: 'good', 5: 'great' } as const;

/**
 * How are you today (or how is mum today, for a relative's diary): the day's wellbeing in the diary in one tap, the
 * same 1–5 scale as the diary. Only that field is written (PUT /symptoms/:date updates the fields it gets), the rest of the day stays.
 */
export function MoodCard({ who, day, value, onSaved }: { who: Addressee | null; day: string; value: number | null; onSaved: (v: number) => void }) {
  const t = useTranslations('home');
  const ts = useTranslations('symptoms');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const name = who?.callName.trim() || '';
  const title = who?.keptBy === 'relative' ? (name ? t('human.moodRelativeName', { name }) : t('human.moodRelative')) : t('human.moodSelf');

  async function pick(v: number) {
    setBusy(v); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/symptoms/${day}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wellbeing: v }) });
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      onSaved(v);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(null); }
  }

  return (
    <div className="card meds-card today-mood">
      <div className="card__title">{title}</div>
      <div className="today-mood__levels" role="radiogroup" aria-label={title}>
        {LEVELS.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={`mood-chip ${value === v ? 'mood-chip--active' : ''}`} disabled={busy !== null} onClick={() => pick(v)}>
            {ts(`wellbeingLevels.${LEVEL_KEY[v]}`)}
          </button>
        ))}
      </div>
      <div className="muted today-mood__note">
        {value ? t.rich('human.moodSaved', { link: (c) => <Link href="/symptoms">{c}</Link> }) : t('human.moodHint')}
      </div>
      {err && <div className="msg msg--error">{err}</div>}
    </div>
  );
}

const HIDDEN_KEY = 'mc_good_news_hidden';
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch { return []; } };

function useHidden() {
  const [hidden, setHidden] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readHidden()));
  const hide = (id: string) => {
    const next = [...hidden, id].slice(-50);
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* private mode: hidden until reload */ }
  };
  return { hidden, hide };
}

/** Quiet milestones: a hundred days of therapy, a year since the start. A few days on the screen, each can be hidden. */
export function Moments({ items }: { items: Moment[] }) {
  const t = useTranslations('home');
  const { hidden, hide } = useHidden();
  const shown = items.filter((x) => !hidden.includes(x.id));
  if (!shown.length) return null;
  return (
    <div className="today-section">
      {shown.map((x) => (
        <div key={x.id} className="today-moment">
          <span>{t(`human.moment.${x.kind}`, { n: x.n })}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => hide(x.id)}>{t('human.hide')}</button>
        </div>
      ))}
    </div>
  );
}

/** After bad news streaks and milestones step aside; one quiet line says so and gives them back. */
export function QuietNote({ quiet, onResume }: { quiet: Quiet; onResume: () => void }) {
  const t = useTranslations('home');
  if (!quiet.on || quiet.reason !== 'badNews') return null;
  return (
    <div className="today-quiet muted">
      {t('human.quietNote')}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onResume}>{t('human.quietResume')}</button>
    </div>
  );
}

/** Good news of the last weeks: a milestone marked as good, a key marker back in range. Each can be hidden. */
export function GoodNews({ items }: { items: GoodNewsItem[] }) {
  const t = useTranslations('home');
  const f = useFormat();
  const { hidden, hide } = useHidden();
  const shown = items.filter((x) => !hidden.includes(x.id));
  if (!shown.length) return null;
  return (
    <div className="today-section">
      {shown.map((x) => (
        <div key={x.id} className="card meds-card good-news">
          <div className="good-news__label">{t('human.goodNews')}</div>
          <Link href={x.kind === 'milestone' ? '/history' : `/labs/series?key=${encodeURIComponent(x.key)}`} className="good-news__title">
            {x.kind === 'milestone' ? x.title : t('human.labNormal', { name: x.short })}
          </Link>
          <div className="good-news__row">
            <span className="muted">{x.kind === 'milestone' ? f.date(x.date, { day: 'numeric', month: 'long' }) : t('human.labNormalSub', { date: f.date(x.date, { day: 'numeric', month: 'long' }) })}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => hide(x.id)}>{t('human.hide')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
