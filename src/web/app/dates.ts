import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateFormat } from '../../shared/prefs.js';
import { usePrefsStore } from './prefs.js';

/**
 * Dates and times as the user wants them (`UserPrefs.dateFormat`), independent of the language: someone playing in
 * English may want European dates. Every date the app shows goes through here.
 */

/** Whether the options give only digits and separators: no month or weekday names, nothing language-specific. */
function numericOnly(o: Intl.DateTimeFormatOptions): boolean {
  if (o.weekday || o.era || o.dayPeriod || o.timeZoneName) return false;
  if (o.month && o.month !== 'numeric' && o.month !== '2-digit') return false;
  return !o.dateStyle || o.dateStyle === 'short';
}

/**
 * The locale to format with. `eu`: German conventions for numeric dates ("09.11.2026, 23:05": digits only, so fine
 * in an English page), British English for dates with month names in an English page ("9 Nov 2026, 23:05"). `us`:
 * American English ("11/09/2026, 11:05 PM"). `auto`: the language's own.
 */
export function dateLocale(lang: string, format: DateFormat, o: Intl.DateTimeFormatOptions): string {
  if (format === 'eu') return lang.startsWith('de') || numericOnly(o) ? 'de-DE' : 'en-GB';
  if (format === 'us') return 'en-US';
  return lang;
}

export function dateTimeFormat(lang: string, format: DateFormat, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(dateLocale(lang, format, o), o);
}

const formatOf = (s: ReturnType<typeof usePrefsStore.getState>): DateFormat => s.local.dateFormat ?? s.saved.dateFormat ?? 'auto';

/** The chosen date format (`auto` when none is chosen). Re-renders when the user changes it. */
export const useDateFormatPref = (): DateFormat => usePrefsStore(formatOf);

/** `useDateFormatPref` outside React (a plain function; it does not re-render on a change). */
export const getDateFormat = (): DateFormat => formatOf(usePrefsStore.getState());

/** A formatter for these options in the language and the chosen date format; the same one until either changes. */
export function useDateTimeFormat(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const { i18n } = useTranslation();
  const format = useDateFormatPref();
  const key = JSON.stringify(o);
  return useMemo(() => dateTimeFormat(i18n.language, format, o), [i18n.language, format, key]);
}

/** Formats with any options (formatters are made once per options, language and date format). */
export function useFormatDate(): (ms: number, o: Intl.DateTimeFormatOptions) => string {
  const { i18n } = useTranslation();
  const format = useDateFormatPref();
  return useMemo(() => {
    const cache = new Map<string, Intl.DateTimeFormat>();
    return (ms, o) => {
      const key = JSON.stringify(o);
      let f = cache.get(key);
      if (!f) cache.set(key, (f = dateTimeFormat(i18n.language, format, o)));
      return f.format(ms);
    };
  }, [i18n.language, format]);
}
