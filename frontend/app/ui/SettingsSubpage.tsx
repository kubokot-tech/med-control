'use client';

import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import EditionText from './EditionText';
import { useEdition } from './edition';

type SettingsKey = Parameters<ReturnType<typeof useTranslations<'settings'>>>[0];

/**
 * A page under Settings: back link (to Settings unless given), title, optional one-line intro, then the content.
 * Titles are translated here, not by the page, so a static export can change language without a server render.
 */
export default function SettingsSubpage({
  title,
  titleKey,
  titleDesktopKey,
  intro,
  introKey,
  introDesktopKey,
  introOffFeature,
  introOffKey,
  back,
  backHref,
  backKey,
  children,
}: {
  title?: React.ReactNode;
  titleKey?: SettingsKey;
  titleDesktopKey?: SettingsKey;
  intro?: React.ReactNode;
  introKey?: SettingsKey;
  introDesktopKey?: SettingsKey;
  /** When this feature is off in the edition, `introOffKey` replaces the intro. */
  introOffFeature?: string;
  introOffKey?: SettingsKey;
  back?: { href: string; label: string };
  backHref?: string;
  backKey?: SettingsKey;
  children: React.ReactNode;
}) {
  const t = useTranslations('settings');
  const ed = useEdition();
  const heading = titleKey
    ? (titleDesktopKey ? <EditionText server={t(titleKey)} desktop={t(titleDesktopKey)} /> : t(titleKey))
    : title;
  const lead = introKey
    ? (introOffKey && introOffFeature && !ed.available(introOffFeature) ? t(introOffKey)
      : introDesktopKey ? <EditionText server={t(introKey)} desktop={t(introDesktopKey)} /> : t(introKey))
    : intro;
  const link = back || { href: backHref || '/settings', label: backKey ? t(backKey) : t('page.title') };
  return (
    <div className="page-container settings-sub">
      <Link href={link.href} className="settings-sub__back"><Icon name="back" size={20} />{link.label}</Link>
      <div className="page-header"><h1 className="page-header__title">{heading}</h1></div>
      {lead && <p className="muted settings-sub__intro">{lead}</p>}
      <div className="settings-sub__body">{children}</div>
    </div>
  );
}
