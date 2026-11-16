'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import MonthReviewSheet from '../ui/MonthReviewSheet';
import Icon from '../ui/icons';

const tabs: { href: string; label: 'summary' | 'series' | 'documents' | 'upload'; match: string[] }[] = [
  { href: '/labs/summary?cat=blood', label: 'summary', match: ['/labs/summary'] },
  { href: '/labs/series?key=ALT', label: 'series', match: ['/labs/series', '/labs/series-raw'] },
  { href: '/labs/documents', label: 'documents', match: ['/labs/documents'] },
  { href: '/labs/upload', label: 'upload', match: ['/labs/upload'] },
];

export default function LabsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('labs');
  const pathname = usePathname();
  const [reviewOpen, setReviewOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  // on a narrow phone the tabs scroll sideways with no visible scrollbar: keep the active one in view
  useEffect(() => { nav.current?.querySelector('.tabs__link--active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [pathname]);
  return (
    <div className="page-container labs-page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-header__title" style={{ marginRight: 'auto' }}>{t('layout.title')}</h1>
        <Link href="/labs/refs" className="btn btn--ghost btn--sm" aria-current={pathname === '/labs/refs' ? 'page' : undefined}><Icon name="ruler" size={20} />{t('layout.refs')}</Link>
        <button type="button" className="btn btn--soft btn--sm" onClick={() => setReviewOpen(true)}>{t('layout.monthReview')}</button>
      </div>
      <MonthReviewSheet open={reviewOpen} onClose={() => setReviewOpen(false)} />
      <nav ref={nav} className="tabs" aria-label={t('layout.tabsLabel')}>
        {tabs.map((tab) => {
          const active = tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
          return (
            <Link key={tab.label} href={tab.href} className={`tabs__link ${active ? 'tabs__link--active' : ''}`}>{t(`layout.tabs.${tab.label}`)}</Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
