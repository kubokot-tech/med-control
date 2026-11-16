'use client';

import { useTranslations } from 'use-intl';
import { useFormat } from './format';
type StreakDay = { date: string; status: string | null };

const LABELS = ['TAKEN', 'SKIPPED', 'PAUSED', 'MISSED', 'OFF'] as const;
const isLabel = (s: string): s is typeof LABELS[number] => (LABELS as readonly string[]).includes(s);

/** 7-per-row heatmap of daily doses, oldest first, last cell = today. */
export default function Streak({ days, compact = false }: { days: StreakDay[]; compact?: boolean }) {
  const t = useTranslations('symptoms.streak');
  const f = useFormat();
  return (
    <div className={`streak-grid ${compact ? 'streak-grid--compact' : ''}`} role="img" aria-label={t('label')}>
      {days.map((d, i) => {
        const cls = d.status === 'TAKEN' ? 'streak__day--taken' : d.status === 'PARTIAL' ? 'streak__day--partial' : d.status === 'MISSED' ? 'streak__day--missed' : d.status === 'SKIPPED' ? 'streak__day--skipped' : d.status === 'PAUSED' ? 'streak__day--paused' : d.status === 'OFF' ? 'streak__day--off' : '';
        const isToday = i === days.length - 1;
        const dateStr = f.date(d.date, { day: 'numeric', month: 'short' });
        return (
          <div
            key={d.date}
            className={`streak__day ${cls} ${isToday ? 'streak__day--today' : ''}`}
            title={t('dayTitle', { date: dateStr, status: d.status ? (isLabel(d.status) ? t(`status.${d.status}`) : d.status) : isToday ? t('todayOpen') : t('noData') })}
          />
        );
      })}
    </div>
  );
}

export function StreakLegend() {
  const t = useTranslations('symptoms.streak');
  return (
    <div className="streak-legend">
      <span><i className="streak__day streak__day--taken" />{t('status.TAKEN')}</span>
      <span><i className="streak__day streak__day--skipped" />{t('status.SKIPPED')}</span>
      <span><i className="streak__day streak__day--paused" />{t('status.PAUSED')}</span>
      <span><i className="streak__day streak__day--missed" />{t('status.MISSED')}</span>
    </div>
  );
}
