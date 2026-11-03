import i18next, { type i18n } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { detectLocale } from '../../../shared/i18n.js';
import de from './de.json';
import en from './en.json';

/**
 * Creates the i18next instance (ICU message syntax) for the browser language and makes it the one
 * `useTranslation` uses. A key missing in German falls back to English.
 */
export function initI18n(languages: readonly string[] = navigator.languages): i18n {
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
