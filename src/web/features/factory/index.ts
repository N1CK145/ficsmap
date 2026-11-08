import { createElement } from 'react';
import type { FeatureModule } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { pageTool } from '../../app/tools.js';
import { FACTORY_PAGE, FactoryPage } from './FactoryPage.js';
import { FactoryIcon } from './icons.js';

export { deleteSnapshot, factoryOf, fetchSnapshot, uploadSnapshot, useSnapshot, useSnapshotList } from './api.js';
export { factoryLabels, prettyClass, useBuildings, useFactoryData, useFactoryDiff, useSnapshotAnalysis } from './data.js';
export type { FactoryData, FactoryLabels, SnapshotAnalysis } from './data.js';
export { FACTORY_PAGE, FactoryPage } from './FactoryPage.js';
export { defaultCompareId, resolveTimeline, stepId, useFactoryWorld, useTimeline } from './timeline.js';
export type { TimelineSelection } from './timeline.js';
export { useFactoryView } from './view.js';
export { LINE_PARAM, linePath } from './lineDiagram.js';

/** "Factory" in the world's navigation, right after the map. */
export const factoryTool = pageTool({ id: 'factory', order: 35, labelKey: 'factory.title', hintKey: 'factory.hint', page: FACTORY_PAGE, icon: createElement(FactoryIcon) });

/**
 * The factory: snapshots of the factory per save (stored on the server) and the page "Factory" (`/w/:id/factory`) with
 * the timeline, the efficiency of machines and items and the vehicle routes. The data layer is `api.ts`, the shared
 * view state (selected snapshot, comparison, highlight) `view.ts`, the analysis `src/shared/factory/analysis.ts`.
 */
export const factoryFeature: FeatureModule = {
  id: 'factory',
  tools: [factoryTool],
  pages: [{ id: FACTORY_PAGE, titleKey: 'factory.title', Component: FactoryPage }],
  sseHandlers: {
    snapshots: (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(ctx.worldId) }); },
  },
};
