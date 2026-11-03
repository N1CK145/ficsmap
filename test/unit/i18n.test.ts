import { detectLocale, localeFromAcceptLanguage } from '../../src/shared/i18n.js';

describe('i18n', () => {
  it('detects German variants', () => {
    expect(detectLocale(['de'])).toBe('de');
    expect(detectLocale(['de-DE'])).toBe('de');
    expect(detectLocale(['de-AT'])).toBe('de');
  });
  it('takes the first de entry anywhere in the list', () => {
    expect(detectLocale(['en-US', 'de'])).toBe('de');
  });
  it('falls back to en', () => {
    expect(detectLocale(['fr', 'en'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
  it('parses Accept-Language', () => {
    expect(localeFromAcceptLanguage('en;q=0.9,de-DE')).toBe('de');
    expect(localeFromAcceptLanguage('fr,en;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
  });
});
