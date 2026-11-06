import type { FeatureModule } from '../../app/feature.js';
import { CoordsReadout } from './CoordsReadout.js';
import { HeightControl } from './HeightControl.js';
import { HeightLayer } from './HeightLayer.js';

/**
 * Coordinates and heights from the dataset's height map: the position under the mouse with the height of
 * the highest surface there, and a switchable colour layer of the heights with its legend.
 */
export const coordsFeature: FeatureModule = {
  id: 'coords',
  mapLayers: [{ id: 'heights', order: 4, Component: HeightLayer }, { id: 'coords', order: 90, Component: CoordsReadout }],
  mapControls: [{ id: 'heights', order: 25, Component: HeightControl }],
};
