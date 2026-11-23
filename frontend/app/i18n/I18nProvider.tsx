'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IntlProvider } from 'use-intl';
import { LANGUAGE_COOKIE, LANGUAGES, pickLanguage, setActiveLanguage, type Language } from './messages';

/** Static export (the iPad build) has no request cookies: the browser choice is applied after paint. */
const STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

const LanguageContext = createContext<{ language: Language; setLanguage: (l: Language) => void }>({ language: 'ru', setLanguage: () => {} });
export const useLanguage = () => useContext(LanguageContext);

/**
 * Interface texts for every screen, the login and setup pages included: useTranslations('section') from use-intl.
 * The server picks the language (i18n/server.ts) and passes it here; users.locale wins once it is known (ui/format.tsx).
 * A change is kept in a cookie for the next first paint, and server components are refreshed to follow it.
 * The static export has nothing to refresh: the dictionaries already live in the page, and the first paint
 * uses the build default until the saved choice or the browser language is applied.
 */
function browserLanguage(): Language {
  const cookie = document.cookie.split('; ').find((c) => c.startsWith(`${LANGUAGE_COOKIE}=`))?.split('=')[1];
  let cached: string | null = null;
  try { cached = JSON.parse(localStorage.getItem('mc_locale') || 'null')?.language ?? null; } catch { /* private mode */ }
  const accept = navigator.languages?.join(',') || navigator.language;
  return pickLanguage(cookie || cached, accept);
}

export default function I18nProvider({ initial, children }: { initial: Language; children: React.ReactNode }) {
  const [language, set] = useState<Language>(initial);
  const router = useRouter();
  const current = useRef(initial);
  const setLanguage = useCallback((l: Language) => {
    if (current.current === l) return;
    current.current = l;
    set(l);
    document.cookie = `${LANGUAGE_COOKIE}=${l}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 10}; SameSite=Lax`;
    document.documentElement.lang = l;
    if (!STATIC) router.refresh();
  }, [router]);
  // After hydration Next writes the title from the static page. Set it again once that pass is done.
  useEffect(() => {
    document.documentElement.lang = language;
    const title = LANGUAGES[language].common.app.title;
    if (!title) return;
    document.title = title;
    // Next writes the title from the static page after the first effects. Set it again once that pass is done.
    const id = window.setTimeout(() => { document.title = title; }, 300);
    return () => window.clearTimeout(id);
  }, [language]);
  useEffect(() => {
    if (!STATIC) return;
    setLanguage(browserLanguage());
  }, [setLanguage]);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  setActiveLanguage(language);
  return (
    <LanguageContext.Provider value={value}>
      <IntlProvider locale={language} messages={LANGUAGES[language]} timeZone="UTC">{children}</IntlProvider>
    </LanguageContext.Provider>
  );
}
