'use client';

import { useTranslations } from 'use-intl';
import { useLanguage } from '../i18n/I18nProvider';

/** Stacked logo with the product name in the reader's language. */
export default function BrandLogo({ alt }: { alt?: string }) {
  const { language } = useLanguage();
  const t = useTranslations('common');
  const src = language === 'ru' ? '/icons/logo-ru.svg' : '/icons/logo-en.svg';
  return <img className="login-logo" src={src} alt={alt || t('app.name')} width={230} height={164} />;
}
