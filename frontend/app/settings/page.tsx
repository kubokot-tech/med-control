'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import { apiJson } from '../ui/api';
import { useFormat } from '../ui/format';
import { SETTINGS_GROUPS } from './sections';
import { rowStatus, attention, type SettingsSummary } from '../ui/settingsStatus';
import { useEdition } from '../ui/edition';

/** Settings: a short list of sections with their state, each on its own page (frontend/app/settings/<section>). */
export default function SettingsPage() {
  const t = useTranslations('settings');
  const f = useFormat();
  const { desktop } = useEdition();
  const [summary, setSummary] = useState<SettingsSummary | null>(null);
  useEffect(() => { apiJson<SettingsSummary>('/api/gateway/settings/summary').then(setSummary).catch(() => { /* rows keep their hints */ }); }, []);
  const problems = summary ? attention(summary, t) : [];

  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-header__title">{t('page.title')}</h1></div>
      {problems.length > 0 && (
        <section className="settings-group">
          <div className="section-label">{t('page.attention')}</div>
          <div className="sheet__list">
            {problems.map((p) => (
              <Link key={p.href + p.text} href={p.href} className="sheet__row settings-row--warn">
                <Icon name="warn" />
                <span className="settings-row__text"><span>{p.text}</span></span>
                <Icon name="chevron" size={20} style={{ color: 'var(--border-2)' }} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {SETTINGS_GROUPS.map((g) => (
        <section key={g.id} className="settings-group">
          <div className="section-label">{t(`groups.${desktop && g.desktopTitle ? g.desktopTitle : g.title}`)}</div>
          <div className="sheet__list">
            {g.rows.map((r) => {
              const st = summary ? rowStatus(r.id, summary, f, t) : null;
              const words = desktop && r.desktop ? r.desktop : r.text;
              return (
                <Link key={r.id} href={r.href} className="sheet__row">
                  <Icon name={r.icon} />
                  <span className="settings-row__text">
                    <span>{t(`rows.${words}.title`)}</span>
                    <span className={`settings-row__sub ${st?.tone === 'warn' ? 'settings-row__sub--warn' : st?.tone === 'ok' ? 'settings-row__sub--ok' : ''}`}>
                      {st?.tone === 'ok' && <i className="settings-dot" aria-hidden="true" />}{st ? st.text : t(`rows.${words}.hint`)}
                    </span>
                  </span>
                  <Icon name="chevron" size={20} style={{ color: 'var(--border-2)' }} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
