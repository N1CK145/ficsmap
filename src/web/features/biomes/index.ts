import type { FeatureModule } from '../../app/feature.js';
import { BiomeLayer } from './BiomeLayer.js';
import { BiomesPanel } from './BiomesPanel.js';
import { ScopeChip } from './ScopeChip.js';

/** Biome labels, outline, scope mask and progress per biome (spec §10.4). */
export const biomesFeature: FeatureModule = {
  id: 'biomes',
  sidebarPanels: [{ id: 'biomes', order: 20, titleKey: 'biomes.title', Component: BiomesPanel }],
  mapLayers: [{ id: 'biomes', order: 10, Component: BiomeLayer }],
  headerItems: [{ id: 'biome-scope', order: 20, Component: ScopeChip }],
};
