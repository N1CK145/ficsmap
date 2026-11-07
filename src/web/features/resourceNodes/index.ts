import type { FeatureModule } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { toggleTool } from '../../app/tools.js';
import { ResourceNodeLayer } from './ResourceNodeLayer.js';
import { ResourceNodesPanel } from './ResourceNodesPanel.js';
import { useNodeLayer, useResourceNodeFile } from './useResourceNodes.js';

/**
 * Resource nodes, geysers and resource wells from the game data (`resource-nodes.json`, optional in a
 * dataset), with the world's own resource and purity where its last save import differs: a map layer with
 * its switch in the tool navigation (hidden for a dataset without nodes), and a sidebar panel with the filters.
 */
export const resourceNodesFeature: FeatureModule = {
  id: 'resourceNodes',
  sidebarPanels: [{ id: 'resource-nodes', order: 40, titleKey: 'resourceNodes.title', Component: ResourceNodesPanel }],
  mapLayers: [{ id: 'resource-nodes', order: 6, Component: ResourceNodeLayer }],
  tools: [toggleTool({
    id: 'resource-nodes', order: 30, labelKey: 'resourceNodes.control', hintKey: 'resourceNodes.hint',
    useToggle: useNodeLayer, useAvailable: ctx => Boolean(useResourceNodeFile(ctx.me.datasetVersion)),
  })],
  sseHandlers: {
    import: (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.nodeOverrides(ctx.worldId) }); },
  },
};
