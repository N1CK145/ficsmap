import { useTranslation } from 'react-i18next';
import { detectLocale, type Locale } from '../../shared/i18n.js';
import { setLocale } from '../app/i18n/index.js';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl.js';

/** Each language under its own name, so it can be found whatever the UI language is. */
const OPTIONS: readonly SegmentedOption<Locale>[] = [
  { value: 'en', label: <><span aria-hidden="true">EN</span><span className="sr-only">English</span></> },
  { value: 'de', label: <><span aria-hidden="true">DE</span><span className="sr-only">Deutsch</span></> },
];

/** EN | DE in the header, next to the account menu; the choice is remembered on this device. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <SegmentedControl
      label={t('language.label')}
      options={OPTIONS}
      value={detectLocale([i18n.language])}
      onChange={l => setLocale(i18n, l)}
    />
  );
}
