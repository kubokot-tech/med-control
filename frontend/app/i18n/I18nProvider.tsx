'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IntlProvider } from 'use-intl';
import { LANGUAGE_COOKIE, LANGUAGES, setActiveLanguage, type Language } from './messages';

const LanguageContext = createContext<{ language: Language; setLanguage: (l: Language) => void }>({ language: 'ru', setLanguage: () => {} });
export const useLanguage = () => useContext(LanguageContext);

/**
 * Interface texts for every screen, the login and setup pages included: useTranslations('section') from use-intl.
 * The server picks the language (i18n/server.ts) and passes it here; users.locale wins once it is known (ui/format.tsx).
 * A change is kept in a cookie for the next first paint, and server components are refreshed to follow it.
 */
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
    router.refresh();
  }, [router]);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  setActiveLanguage(language);
  return (
    <LanguageContext.Provider value={value}>
      <IntlProvider locale={language} messages={LANGUAGES[language]} timeZone="UTC">{children}</IntlProvider>
    </LanguageContext.Provider>
  );
}
