import en from '../../src/web/app/i18n/en.json';
import de from '../../src/web/app/i18n/de.json';
import { COLLECTIBLE_TYPES } from '../../src/shared/collectibleTypes.js';
import { initI18n } from '../../src/web/app/i18n/index.js';

function flatKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flatKeys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

describe('i18n catalogs', () => {
  it('en and de have identical key sets', () => {
    expect(flatKeys(de).sort()).toEqual(flatKeys(en).sort());
  });

  it('has every types.* key the registry references', () => {
    const keys = new Set(flatKeys(en));
    for (const t of COLLECTIBLE_TYPES) expect(keys, t.labelKey).toContain(t.labelKey);
  });
});

describe('initI18n', () => {
  it('picks German for a de-* browser language and sets <html lang>', () => {
    const i18n = initI18n(['de-AT', 'en-US']);
    expect(i18n.language).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(i18n.t('login.signIn')).toBe(de.login.signIn);
  });

  it('falls back to English otherwise', () => {
    const i18n = initI18n(['fr-FR']);
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('login.signIn')).toBe('Sign in with Discord');
  });

  it('falls back to the English string for a key missing in German', () => {
    const i18n = initI18n(['de']);
    i18n.addResource('en', 'translation', 'test.onlyEn', 'English only');
    expect(i18n.t('test.onlyEn')).toBe('English only');
  });

  it('formats ICU plurals', () => {
    const i18n = initI18n(['en']);
    i18n.addResource('en', 'translation', 'test.items', '{count, plural, one {# item} other {# items}}');
    expect(i18n.t('test.items', { count: 1 })).toBe('1 item');
    expect(i18n.t('test.items', { count: 3 })).toBe('3 items');
  });
});
