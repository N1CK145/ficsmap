import type { FeatureModule } from '../../app/feature.js';
import { CaveControl } from './CaveControl.js';
import { CaveLayer } from './CaveLayer.js';
import { InCave } from './InCave.js';

/**
 * Caves from the game data (`caves.geojson`, optional in a dataset): a layer with the cave areas and
 * entrances, its on/off control, and an "in a cave" note in the item panel.
 */
export const cavesFeature: FeatureModule = {
  id: 'caves',
  mapLayers: [{ id: 'caves', order: 5, Component: CaveLayer }],
  mapControls: [{ id: 'caves', order: 20, Component: CaveControl }],
  itemDetailSections: [{ id: 'in-cave', order: 25, applies: item => item.extra?.cave === true, Component: InCave }],
};
