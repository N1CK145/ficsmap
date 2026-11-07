import type { FeatureModule } from '../app/feature.js';
import { biomesFeature } from './biomes/index.js';
import { cavesFeature } from './caves/index.js';
import { coordsFeature } from './coords/index.js';
import { conflictsFeature } from './conflicts/index.js';
import { importFeature } from './import/index.js';
import { itemPanelFeature } from './itemPanel/index.js';
import { listViewFeature } from './listView/index.js';
import { machineWikiFeature } from './machineWiki/index.js';
import { liveFeature } from './live/index.js';
import { mapFeature } from './map/index.js';
import { marksFeature } from './marks/index.js';
import { plannerFeature } from './planner/index.js';
import { progressFeature } from './progress/index.js';
import { resourceNodesFeature } from './resourceNodes/index.js';
import { routesFeature } from './routes/index.js';
import { searchFeature } from './search/index.js';
import { sharingFeature } from './sharing/index.js';
import { vehicleCalcFeature } from './vehicleCalc/index.js';
import { worldsFeature } from './worlds/index.js';

/** Every feature, in one list (spec §4.2). Order here is the order of routes and SSE handlers. */
export const FEATURES: FeatureModule[] = [worldsFeature, marksFeature, liveFeature, mapFeature, progressFeature, biomesFeature, cavesFeature, coordsFeature, resourceNodesFeature, itemPanelFeature, routesFeature, importFeature, conflictsFeature, sharingFeature, listViewFeature, searchFeature, vehicleCalcFeature, plannerFeature, machineWikiFeature];
