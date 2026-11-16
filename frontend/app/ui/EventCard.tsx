'use client';

import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { createTranslator } from 'use-intl/core';
import Icon, { type IconName } from './icons';
import type { Format } from '../../../shared/format.js';
import { useFormat } from './format';
import { DEFAULT_LANGUAGE, LANGUAGES, isLanguage } from '../i18n/messages';

export type FeedItem = {
  id: string;
  type: string;
  occurredAt: string;
  day: string;
  title: string | null;
  notes: string | null;
  source: string | null;
  lab: { documentId: string | null; labName: string | null; total: number; flagged: number } | null;
  med: { status: string | null } | null;
  milestone?: { kind: string; tone: string } | null;
  note?: { id: string | null } | null;
  symptom?: { summary: string } | null;
};

type FeedT = ReturnType<typeof useTranslations<'feed'>>;

export function describe(item: FeedItem, f: Format, t: FeedT): { icon: IconName; kind: string; title: string; sub: React.ReactNode; href: string | null } {
  if (item.type === 'LAB_RESULT') {
    const lab = item.lab;
    const total = lab?.total ?? 0;
    const flagged = lab?.flagged ?? 0;
    return {
      icon: 'labs',
      kind: 'labs',
      title: t('eventCard.labTitle', { lab: lab?.labName || t('eventCard.labDefault') }),
      sub: total
        ? flagged
          ? t.rich('eventCard.labFlagged', { total, flagged, warn: (c) => <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{c}</span> })
          : t('eventCard.labAllNormal', { total })
        : t('eventCard.labUploaded'),
      href: lab?.documentId ? `/labs/documents/${lab.documentId}` : '/labs/documents',
    };
  }
  if (item.type === 'MED_ADMIN') {
    const status = item.med?.status;
    const name = (item.title || '').split(':')[0] || t('eventCard.medDefault');
    const title = status === 'TAKEN' ? t('eventCard.medTaken', { name })
      : status === 'SKIPPED' ? t('eventCard.medSkipped', { name })
        : status === 'PAUSED' ? t('eventCard.medPaused', { name })
          : status === 'MISSED' ? t('eventCard.medMissed', { name })
            : name;
    return {
      icon: 'meds',
      kind: 'meds',
      title: title.trim(),
      sub: <>{f.time(item.occurredAt)}{item.notes ? ` · ${item.notes}` : ''}</>,
      href: null,
    };
  }
  if (item.type === 'MILESTONE') {
    const kind = item.milestone?.kind || 'other';
    const icon: IconName = kind === 'imaging' ? 'imaging' : kind === 'histology' ? 'labs' : kind === 'consult' ? 'consult' : 'doc';
    return { icon, kind: `ms-${item.milestone?.tone || 'neutral'}`, title: item.title || t('eventCard.milestoneDefault'), sub: item.notes || '', href: kind === 'imaging' ? '/imaging' : '/history' };
  }
  if (item.type === 'NOTE' && item.source === 'notes') return { icon: 'doc', kind: 'other', title: item.title || t('eventCard.noteDefault'), sub: item.notes || '', href: item.note?.id ? `/notes/${item.note.id}` : '/notes' };
  if (item.type === 'NOTE' && item.source === 'meds') return { icon: 'meds', kind: 'meds', title: item.title || t('eventCard.doseChangeDefault'), sub: item.notes || '', href: '/meds' };
  if (item.type === 'INFUSION') return { icon: 'drip', kind: 'other', title: item.title || t('eventCard.infusionDefault'), sub: item.notes || '', href: '/infusions' };
  if (item.type === 'SYMPTOM') return { icon: 'symptoms', kind: 'other', title: item.symptom ? `${t('eventCard.symptomPrefix')}${item.symptom.summary}` : item.title || '', sub: item.notes || '', href: '/symptoms' };
  const icon: IconName = item.type === 'IMAGING' ? 'imaging' : item.type === 'CONSULT' ? 'consult' : 'doc';
  return { icon, kind: 'other', title: item.title || item.type, sub: item.notes || '', href: null };
}

export default function EventCard({ item }: { item: FeedItem }) {
  const f = useFormat();
  const t = useTranslations('feed');
  const d = describe(item, f, t);
  const inner = (
    <>
      <div className={`event-card__icon event-card__icon--${d.kind}`}><Icon name={d.icon} size={22} /></div>
      <div className="event-card__body">
        <div className="event-card__title">{d.title}</div>
        <div className="event-card__sub">{d.sub}</div>
      </div>
      {d.href && <Icon name="chevron" size={20} className="event-card__chevron" />}
    </>
  );
  return d.href
    ? <Link href={d.href} className="event-card">{inner}</Link>
    : <div className="event-card">{inner}</div>;
}

/** Long day ("2 September" / "2 September 2025" in the user's formats) from YYYY-MM-DD */
export function fmtDayLong(f: Format, key: string, withYear = false) {
  return f.date(key, withYear ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' });
}

/** Weekday name with a capital letter ("Monday") */
export function fmtWeekday(f: Format, key: string) {
  const w = f.date(key, { weekday: 'long' });
  return w.charAt(0).toLocaleUpperCase(f.language) + w.slice(1);
}

// dayHeading is a plain function called from screens: texts in the default language, like i18n/server.ts.
const dayT = (f: Format) => {
  const locale = isLanguage(f.language) ? f.language : DEFAULT_LANGUAGE;
  return createTranslator({ locale, messages: LANGUAGES[locale], namespace: 'feed.day' });
};

/** Day header relative to today/yesterday keys */
export function dayHeading(f: Format, key: string, todayKey: string, yesterdayKey: string) {
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  if (key === todayKey) return dayT(f)('today');
  if (key === yesterdayKey) return dayT(f)('yesterday', { date: fmtDayLong(f, key) });
  return fmtDayLong(f, key, !sameYear);
}
