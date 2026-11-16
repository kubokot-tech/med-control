import Link from 'next/link';
import Icon from './icons';
import { serverT } from '../i18n/server';

/** A page under Settings: back link (to Settings unless given), title, optional one-line intro, then the content. */
export default async function SettingsSubpage({ title, intro, back, children }: { title: React.ReactNode; intro?: React.ReactNode; back?: { href: string; label: string }; children: React.ReactNode }) {
  const t = await serverT('settings');
  const link = back || { href: '/settings', label: t('page.title') };
  return (
    <div className="page-container settings-sub">
      <Link href={link.href} className="settings-sub__back"><Icon name="back" size={20} />{link.label}</Link>
      <div className="page-header"><h1 className="page-header__title">{title}</h1></div>
      {intro && <p className="muted settings-sub__intro">{intro}</p>}
      <div className="settings-sub__body">{children}</div>
    </div>
  );
}
