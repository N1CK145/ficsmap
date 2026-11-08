import type { FeatureModule } from '../../app/feature.js';
import { BiomeLayer } from './BiomeLayer.js';
import { BiomesPanel } from './BiomesPanel.js';
import { ScopeChip } from './ScopeChip.js';
import { biomesSearch } from './search.js';

/** Biome labels, outline, scope mask and progress per biome (spec §10.4), and the biomes in the search. */
export const biomesFeature: FeatureModule = {
  id: 'biomes',
  sidebarPanels: [{ id: 'biomes', order: 100, titleKey: 'biomes.title', Component: BiomesPanel, defaultCollapsed: true }],
  mapLayers: [{ id: 'biomes', order: 10, Component: BiomeLayer }],
  headerItems: [{ id: 'biome-scope', order: 20, Component: ScopeChip }],
  searchProviders: [biomesSearch],
};
