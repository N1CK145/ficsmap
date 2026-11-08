import type { TFunction } from 'i18next';
import { typeById } from '../../../shared/collectibleTypes.js';
import type { Dataset, Item } from '../../../shared/dataset.js';
import type { Locale } from '../../../shared/types.js';

/**
 * The main label of an item (spec §10 "Item labels"): type, biome and the number within the biome. A no-break space
 * keeps the number with the biome when a narrow list wraps the label ("Rocky Desert 1", never "Rocky Desert / 1").
 */
export function itemLabel(item: Item, t: TFunction, biomes: Dataset['biomes'], locale: Locale): string {
  const type = t(typeById(item.type).labelKey);
  const biome = biomes[item.biome]?.name[locale];
  return biome ? `${type} · ${biome}\u00a0${item.seq}` : `${type}\u00a0${item.seq}`;
}

