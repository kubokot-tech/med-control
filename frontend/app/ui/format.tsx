'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createFormat, type Format, type RegionPrefs } from '../../../shared/format.js';
import { apiJson } from './api';
import { useLanguage } from '../i18n/I18nProvider';
import { isLanguage } from '../i18n/messages';

/** Language, regional settings and time zone of the user, as GET /settings/locale returns them (docs/I18N.md). */
export type LocaleSettings = { language: string; prefs: RegionPrefs; timeZone: string };

const CACHE_KEY = 'mc_locale';
const readCache = (): LocaleSettings | null => {
  try { const s = localStorage.getItem(CACHE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
};
const writeCache = (v: LocaleSettings) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

type Ctx = { format: Format; settings: LocaleSettings | null; apply: (s: LocaleSettings) => void };
const FormatContext = createContext<Ctx>({ format: createFormat(), settings: null, apply: () => {} });

/**
 * Loads the user's settings once (cached between visits so the first paint already uses them) and gives every screen
 * the same formatter. Settings → Language and region calls apply() after saving, and the open screens re-render.
 */
export function FormatProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<LocaleSettings | null>(() => (typeof window === 'undefined' ? null : readCache()));
  const { setLanguage } = useLanguage();
  const apply = useCallback((s: LocaleSettings) => {
    writeCache(s); setSettings(s);
    if (isLanguage(s.language)) setLanguage(s.language);
  }, [setLanguage]);
  useEffect(() => {
    apiJson<LocaleSettings>('/api/gateway/settings/locale')
      .then((s) => apply({ language: s.language, prefs: s.prefs, timeZone: s.timeZone }))
      .catch(() => { /* offline or an old gateway: keep the cached or default formats */ });
  }, [apply]);
  const format = useMemo(() => createFormat(settings || undefined), [settings]);
  const value = useMemo(() => ({ format, settings, apply }), [format, settings, apply]);
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

/** Dates, times and numbers in the user's formats: f.date(value, options?), f.time(value), f.number(n, options?). */
export const useFormat = (): Format => useContext(FormatContext).format;
export const useLocaleSettings = () => {
  const { settings, apply } = useContext(FormatContext);
  return { settings, apply };
};
