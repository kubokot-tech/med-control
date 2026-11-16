'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import Icon, { type IconName } from './icons';
import BottomSheet from './BottomSheet';
import { useLanguage } from '../i18n/I18nProvider';

type Label = 'today' | 'labs' | 'meds' | 'imaging' | 'search' | 'history' | 'symptoms' | 'infusions' | 'consults' | 'contacts' | 'notes' | 'alerts' | 'report' | 'settings';

const primary: { href: string; label: Label; icon: IconName; prefix?: string }[] = [
  { href: '/', label: 'today', icon: 'today' },
  { href: '/labs', label: 'labs', icon: 'labs', prefix: '/labs' },
  { href: '/meds', label: 'meds', icon: 'meds', prefix: '/meds' },
  { href: '/imaging', label: 'imaging', icon: 'imaging', prefix: '/imaging' },
];

// On a computer the side rail has room for these; the phone keeps them in «More».
const rail: { href: string; label: Label; icon: IconName }[] = [
  { href: '/history', label: 'history', icon: 'timeline' },
  { href: '/symptoms', label: 'symptoms', icon: 'symptoms' },
  { href: '/infusions', label: 'infusions', icon: 'drip' },
  { href: '/consults', label: 'consults', icon: 'consult' },
  { href: '/report', label: 'report', icon: 'doc' },
];
const onRail = (href: string) => rail.some((r) => r.href === href);

const more: { href: string; label: Label; icon: IconName }[] = [
  { href: '/search', label: 'search', icon: 'search' },
  { href: '/history', label: 'history', icon: 'doc' },
  { href: '/symptoms', label: 'symptoms', icon: 'symptoms' },
  { href: '/infusions', label: 'infusions', icon: 'drip' },
  { href: '/consults', label: 'consults', icon: 'consult' },
  { href: '/contacts', label: 'contacts', icon: 'user' },
  { href: '/notes', label: 'notes', icon: 'doc' },
  { href: '/alerts', label: 'alerts', icon: 'bell' },
  { href: '/report', label: 'report', icon: 'download' },
  { href: '/settings', label: 'settings', icon: 'settings' },
];

export default function MainNav() {
  const t = useTranslations('common');
  const { language } = useLanguage();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (item: { href: string; prefix?: string }) =>
    item.prefix ? pathname.startsWith(item.prefix) : pathname === item.href;
  const moreActive = more.some((m) => pathname.startsWith(m.href));
  const moreOnly = more.some((m) => !onRail(m.href) && pathname.startsWith(m.href));

  function logout() {
    localStorage.removeItem('dtc_token');
    window.location.href = '/login';
  }

  return (
    <>
      <nav className="main-nav" aria-label={t('nav.label')}>
        <div className="main-nav__brand" title={t('app.name')}><img src={`/icons/logo-${language}.svg`} alt={t('app.name')} width={62} height={44} /></div>
        {primary.map((item) => (
          <Link key={item.href} href={item.href} className={`main-nav__item ${isActive(item) ? 'main-nav__item--active' : ''}`}>
            <Icon name={item.icon} />
            <span>{t(`nav.${item.label}`)}</span>
          </Link>
        ))}
        {rail.map((item) => (
          <Link key={item.href} href={item.href} className={`main-nav__item main-nav__item--rail ${pathname.startsWith(item.href) ? 'main-nav__item--active' : ''}`}>
            <Icon name={item.icon} />
            <span>{t(`nav.${item.label}`)}</span>
          </Link>
        ))}
        <button type="button" className={`main-nav__item ${moreActive ? 'main-nav__more--phone' : ''} ${moreOnly ? 'main-nav__item--active' : ''}`} onClick={() => setMoreOpen(true)}>
          <Icon name="more" />
          <span>{t('nav.more')}</span>
        </button>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <div className="sheet__list">
          {more.map((m) => (
            <Link key={m.href} href={m.href} className={`sheet__row ${onRail(m.href) ? 'sheet__row--phone' : ''}`} onClick={() => setMoreOpen(false)}>
              <Icon name={m.icon} />
              <span>{t(`nav.${m.label}`)}</span>
              <Icon name="chevron" size={20} style={{ color: 'var(--border-2)' }} />
            </Link>
          ))}
          <button type="button" className="sheet__row" onClick={logout}>
            <Icon name="logout" />
            <span>{t('nav.logout')}</span>
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
