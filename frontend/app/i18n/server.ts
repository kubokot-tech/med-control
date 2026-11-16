import { cookies, headers } from 'next/headers';
import { createTranslator } from 'use-intl/core';
import { LANGUAGE_COOKIE, LANGUAGES, pickLanguage, type Language, type Messages } from './messages';

/** The language for this request: the user's choice from the cookie, else the browser's. */
export async function serverLanguage(): Promise<Language> {
  return pickLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value, (await headers()).get('accept-language'));
}

/** Texts for server components (page titles and metadata). */
export async function serverT<N extends keyof Messages>(namespace: N) {
  const locale = await serverLanguage();
  return createTranslator({ locale, messages: LANGUAGES[locale], namespace });
}
