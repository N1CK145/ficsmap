import en from '../../src/web/app/i18n/en.json';
import de from '../../src/web/app/i18n/de.json';
import { COLLECTIBLE_TYPES } from '../../src/shared/collectibleTypes.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { sortResources } from '../../src/web/features/resourceNodes/resourceStyle.js';
import { NODE_PURITY_SETTINGS, NODE_RANDOMIZATION_MODES } from '../../src/shared/resourceNodes.js';

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

  it('names every resource the node layer styles, with a short label, in both languages', () => {
    const ids = sortResources(Object.keys(en.resourceNodes.resources));
    for (const lang of [en, de]) {
      const keys = new Set(flatKeys(lang));
      for (const id of ids) {
        expect(keys).toContain(`resourceNodes.resources.${id}`);
        expect(keys).toContain(`resourceNodes.short.${id}`);
      }
    }
    for (const id of ['Desc_OreIron_C', 'Desc_SAM_C', 'Desc_NitrogenGas_C', 'Geyser']) expect(ids).toContain(id);
  });
});

describe('node randomisation settings', () => {
  it('names every member of the game\'s two setting enums in both languages, with the game\'s own strings', () => {
    for (const lang of [en, de]) {
      const ns = lang.resourceNodes.nodeSettings;
      expect(Object.keys(ns.randomizationValues).sort()).toEqual([...NODE_RANDOMIZATION_MODES].sort());
      expect(Object.keys(ns.purityValues).sort()).toEqual([...NODE_PURITY_SETTINGS].sort());
    }
    // AllStringTables.locres (Menus_UI), build 517554, as the settings assets map them to the enum values.
    expect(en.resourceNodes.nodeSettings.randomizationValues.NRM_Strict).toBe('Random');
    expect(de.resourceNodes.nodeSettings.randomizationValues.NRM_BasicReach).toBe('Reich: Grundressourcen');
    expect(de.resourceNodes.nodeSettings.purityValues.NPS_AllNormal).toBe('Durchschnittlich');
    expect(de.resourceNodes.nodeSettings.randomization).toBe('Zufällige Rohstoffvorkommen');
  });

  it('uses the game\'s German terms for resource nodes', () => {
    // CommunityResources/Docs/de.json Desc_OreGold_C and the game's own descriptions (Rohstoffvorkommen, Unterknoten einer Rohstoffquelle).
    expect(de.resourceNodes.resources.Desc_OreGold_C).toBe('Caterium-Erz');
    expect(de.resourceNodes.kinds).toMatchObject({ node: 'Rohstoffvorkommen', core: 'Rohstoffquelle (Mitte)', satellite: 'Unterknoten einer Rohstoffquelle' });
    expect(JSON.stringify(de.resourceNodes)).not.toMatch(/Ressourcenvorkommen|Ressourcenquelle|Cateriumerz/);
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
