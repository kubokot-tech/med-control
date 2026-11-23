'use client';

import { useTranslations } from 'use-intl';
import BrandLogo from './BrandLogo';
import EditionText from './EditionText';

/** Login, setup and offline headings. Client-side so a static export can switch language after the first paint. */
export function LoginChrome() {
  const t = useTranslations('auth');
  return (
    <div>
      <BrandLogo />
      <div className="login-tagline">{t('loginPage.title')}</div>
      <div className="login-desc">{t('loginPage.description')}</div>
      <div className="login-desc login-desc--short">{t('loginPage.descriptionShort')}</div>
    </div>
  );
}

export function SetupChrome() {
  const t = useTranslations('auth');
  return (
    <div>
      <BrandLogo />
      <div className="login-tagline"><EditionText server={t('setupPage.taglineServer')} desktop={t('setupPage.taglineDesktop')} /></div>
    </div>
  );
}

export function OfflineChrome() {
  const t = useTranslations('auth');
  return (
    <div>
      <BrandLogo />
      <div className="login-tagline">{t('offlinePage.tagline')}</div>
    </div>
  );
}
