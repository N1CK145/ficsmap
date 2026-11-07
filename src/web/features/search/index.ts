import type { FeatureModule } from '../../app/feature.js';
import { collectiblesSearch } from './collectibles.js';
import { MapFitLayer } from './fit.js';
import { SearchBox } from './SearchBox.js';

/**
 * The header search (centred in the top bar). Results come from every feature's `searchProviders`;
 * this feature brings the collectibles (types and single items). Biomes, caves and crash sites come
 * from their own features. `MapFitLayer` carries out area fits that results ask for (`useMapFit`).
 */
export const searchFeature: FeatureModule = {
  id: 'search',
  headerItems: [{ id: 'search', order: 0, slot: 'center', Component: SearchBox }],
  searchProviders: [collectiblesSearch],
  mapLayers: [{ id: 'search-fit', order: 110, Component: MapFitLayer }],
};
