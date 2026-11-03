import type { Dataset, Item } from '../../src/shared/dataset.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { itemLabel } from '../../src/web/features/itemPanel/label.js';

// Biome names as the dataset carries them (English in both locales).
const ds: Pick<Dataset, 'biomes'> = { biomes: [{ id: 'swamp', name: { en: 'Swamp', de: 'Swamp' } }, { id: 'grass-fields', name: { en: 'Grass Fields', de: 'Grass Fields' } }] };
const grassFields = 1;

const item = (type: Item['type'], seq: number): Item => ({ name: 'BP_X_1', type, x: 0, y: 0, z: 0, biome: grassFields, seq });

describe('itemLabel', () => {
  it('names type, biome and number in English', () => {
    const { t } = initI18n(['en']);
    expect(itemLabel(item('somersloop', 12), t, ds.biomes, 'en')).toBe('Somersloop · Grass Fields 12');
  });

  it('uses the German type label and the dataset biome name in German', () => {
    const { t } = initI18n(['de']);
    expect(itemLabel(item('somersloop', 12), t, ds.biomes, 'de')).toBe('Somersloop · Grass Fields 12');
    expect(itemLabel(item('hard_drive', 3), t, ds.biomes, 'de')).toBe('Festplatte · Grass Fields 3');
  });
});
