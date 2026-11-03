export type Locale = 'en' | 'de';

/** First entry starting with `de` wins; anything else is English. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some(l => l.trim().toLowerCase().startsWith('de')) ? 'de' : 'en';
}

export function localeFromAcceptLanguage(header: string | undefined): Locale {
  const langs = (header ?? '').split(',').map(p => (p.split(';')[0] ?? '').trim()).filter(Boolean);
  return detectLocale(langs);
}
