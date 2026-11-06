import i18next, { type i18n } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { detectLocale, type Locale } from '../../../shared/i18n.js';
import { loadLocale, saveLocale } from '../persist.js';
import de from './de.json';
import en from './en.json';

/** The language picked in the header if there is one, else the browser's languages. */
function preferredLanguages(): readonly string[] {
  const stored = loadLocale();
  return stored ? [stored] : navigator.languages;
}

/**
 * Creates the i18next instance (ICU message syntax) for the preferred language and makes it the one
 * `useTranslation` uses. A key missing in German falls back to English.
 */
export function initI18n(languages: readonly string[] = preferredLanguages()): i18n {
  const lng = detectLocale(languages);
  const instance = i18next.createInstance();
  void instance.use(ICU).use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources: { en: { translation: en }, de: { translation: de } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  document.documentElement.lang = lng;
  return instance;
}

/** Switches the UI language (the language switch in the header) and remembers it on this device. */
export function setLocale(instance: i18n, locale: Locale): void {
  void instance.changeLanguage(locale);
  document.documentElement.lang = locale;
  saveLocale(locale);
}
