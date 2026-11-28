import type { FeatureModule, SseHandlerMap, WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { ActivityPanel } from './ActivityPanel.js';

const refetch = (_e: unknown, ctx: WorldCtx) => void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.activity(ctx.worldId) });

/**
 * Who is in the world and what changed lately (sidebar panel, folded by default). The feed has no event of its own:
 * the events of the changes it lists refetch it (only while the panel is open, as react-query refetches active queries).
 */
export const activityFeature: FeatureModule = {
  id: 'activity',
  sidebarPanels: [{ id: 'activity', order: 90, titleKey: 'activity.title', Component: ActivityPanel, defaultCollapsed: true }],
  sseHandlers: {
    mark: refetch, 'marks-bulk': refetch, import: refetch, world: refetch, members: refetch, routes: refetch, snapshots: refetch,
  } satisfies Partial<SseHandlerMap>,
};
