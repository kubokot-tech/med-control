import './globals.css';
import AppShell from './ui/AppShell';
import PwaRegister from './ui/PwaRegister';
import I18nProvider from './i18n/I18nProvider';
import { serverLanguage, serverT } from './i18n/server';

export async function generateMetadata() {
  const language = await serverLanguage();
  const t = await serverT('common');
  return {
    title: t('app.title'),
    description: t('app.description'),
    manifest: language === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest',
    appleWebApp: { capable: true, title: t('app.name'), statusBarStyle: 'default' as const },
    icons: {
      icon: [
        { url: '/icons/favicon.svg', type: 'image/svg+xml' },
        { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: '/icons/icon-180.png',
    },
  };
}
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const, themeColor: '#f4f1ec' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = await serverLanguage();
  return (
    <html lang={language}>
      <head>
        <link rel="preload" href="/fonts/sourcesans3-cyrillic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/literata-cyrillic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link href="/fonts/fonts.css" rel="stylesheet" />
      </head>
      <body>
        <I18nProvider initial={language}>
          <AppShell>{children}</AppShell>
          <PwaRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
