import { createElement } from 'react';
import type { FeatureModule } from '../../app/feature.js';
import { HeightIcon } from '../../components/icons.js';
import { toggleTool } from '../../app/tools.js';
import { CoordsReadout } from './CoordsReadout.js';
import { HeightLayer } from './HeightLayer.js';
import { useHeightLayer, useHeightSource } from './useHeights.js';

/**
 * Coordinates and heights from the dataset's height map: the position under the mouse with the height of
 * the highest surface there, and a colour layer of the heights with its legend, switched in the tool
 * navigation (hidden for a dataset without heights).
 */
export const coordsFeature: FeatureModule = {
  id: 'coords',
  mapLayers: [{ id: 'heights', order: 4, Component: HeightLayer }, { id: 'coords', order: 90, Component: CoordsReadout }],
  tools: [toggleTool({
    id: 'heights', order: 25, labelKey: 'heights.control', hintKey: 'heights.hint', icon: createElement(HeightIcon),
    useToggle: useHeightLayer, useAvailable: ctx => Boolean(useHeightSource(ctx.me.datasetVersion)),
  })],
};
