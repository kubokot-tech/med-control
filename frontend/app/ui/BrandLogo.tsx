import { serverLanguage } from '../i18n/server';

/** Stacked logo with the product name in the reader's language. */
export default async function BrandLogo({ alt }: { alt: string }) {
  const lang = await serverLanguage();
  const src = lang === 'ru' ? '/icons/logo-ru.svg' : '/icons/logo-en.svg';
  return <img className="login-logo" src={src} alt={alt} width={230} height={164} />;
}
