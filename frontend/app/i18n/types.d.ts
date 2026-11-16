import type { Language, Messages } from './messages';

// TypeScript checks every useTranslations()/t() key against the Russian dictionary.
declare module 'use-intl' {
  interface AppConfig {
    Locale: Language;
    Messages: Messages;
  }
}
