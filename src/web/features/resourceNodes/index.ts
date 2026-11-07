import type { FeatureModule } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { ResourceNodeControl } from './ResourceNodeControl.js';
import { ResourceNodeLayer } from './ResourceNodeLayer.js';
import { ResourceNodesPanel } from './ResourceNodesPanel.js';

/**
 * Resource nodes, geysers and resource wells from the game data (`resource-nodes.json`, optional in a
 * dataset), with the world's own resource and purity where its last save import differs: a switchable map
 * layer, its control, and a sidebar panel with the filters.
 */
export const resourceNodesFeature: FeatureModule = {
  id: 'resourceNodes',
  sidebarPanels: [{ id: 'resource-nodes', order: 40, titleKey: 'resourceNodes.title', Component: ResourceNodesPanel }],
  mapLayers: [{ id: 'resource-nodes', order: 6, Component: ResourceNodeLayer }],
  mapControls: [{ id: 'resource-nodes', order: 22, Component: ResourceNodeControl }],
  sseHandlers: {
    import: (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.nodeOverrides(ctx.worldId) }); },
  },
};
