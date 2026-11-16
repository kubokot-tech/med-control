'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiJson } from './api';
import { setupSteps, type SettingsSummary } from './settingsStatus';

const HIDE_KEY = 'mc_setup_hidden';

/**
 * The «getting started» checklist on the Today screen after the first run: protocol, anamnesis, AI key, Telegram. Neutral, can be
 * hidden on this device, and goes away by itself once every step is done.
 */
export default function SetupChecklist() {
  const t = useTranslations('settings');
  const [summary, setSummary] = useState<SettingsSummary | null>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let h = false;
    try { h = localStorage.getItem(HIDE_KEY) === '1'; } catch { /* private mode */ }
    setHidden(h);
    if (!h) apiJson<SettingsSummary>('/api/gateway/settings/summary').then(setSummary).catch(() => {});
  }, []);
  if (hidden || !summary) return null;
  const steps = setupSteps(summary, t);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ } setHidden(true); };

  return (
    <div className="card meds-card setup-checklist">
      <div className="meds-card__row">
        <div className="card__title">{t('setup.title', { done, total: steps.length })}</div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={hide}>{t('setup.hide')}</button>
      </div>
      <div className="sheet__list">
        {steps.map((s) => (
          <Link key={s.id} href={s.href} className="sheet__row">
            <span className={`setup-checklist__mark ${s.done ? 'setup-checklist__mark--done' : ''}`} aria-label={s.done ? t('setup.done') : t('setup.notDone')}>{s.done && <Icon name="check" size={16} strokeWidth={2.6} />}</span>
            <span className="settings-row__text">
              <span>{s.title}</span>
              <span className="settings-row__sub">{s.why}</span>
            </span>
            <Icon name="chevron" size={20} style={{ color: 'var(--border-2)' }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
