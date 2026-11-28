import { createElement } from 'react';
import type { FeatureModule } from '../../app/feature.js';
import { CaveIcon } from '../../components/icons.js';
import { toggleTool } from '../../app/tools.js';
import { CaveInfo } from './CaveInfo.js';
import { CaveLayer } from './CaveLayer.js';
import { InCave } from './InCave.js';
import { cavesSearch } from './search.js';
import { hasCaves, useCaveLayer } from './useCaves.js';

/**
 * Caves from the game data (`caves.geojson`, optional in a dataset): a layer with the cave areas and
 * entrances, its on/off switch in the tool navigation (hidden for a dataset without caves), the caves
 * in the search, and an "in a cave" note in the item panel. A click on a cave opens its box, and from there (or
 * the item panel) its 3D view, when the dataset has the cave's model (part `cave-models`).
 */
export const cavesFeature: FeatureModule = {
  id: 'caves',
  mapLayers: [{ id: 'caves', order: 5, Component: CaveLayer }],
  mapOverlays: [{ id: 'cave-info', order: 20, Component: CaveInfo }],
  tools: [toggleTool({
    id: 'caves', order: 20, labelKey: 'caves.control', hintKey: 'caves.hint', icon: createElement(CaveIcon),
    useToggle: useCaveLayer, useAvailable: ctx => hasCaves(ctx.index),
  })],
  searchProviders: [cavesSearch],
  itemDetailSections: [{ id: 'in-cave', order: 25, applies: item => item.extra?.cave === true, Component: InCave }],
};
