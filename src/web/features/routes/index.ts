import { getI18n } from 'react-i18next';
import type { Item } from '../../../shared/dataset.js';
import type { FeatureModule, WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { AddToRouteAction } from './AddToRouteAction.js';
import { PodChecklistOverlay } from './PodChecklistOverlay.js';
import { RouteLayer } from './RouteLayer.js';
import { RoutesHost, RoutesPanel } from './RoutesPanel.js';
import { defaultRouteName, useRouteDraft, type DraftEnv } from './useRoutes.js';

/** A marker click in route mode: sets the start ([Change] or the first click), then adds or removes a stop. */
function onRouteClick(item: Item, ctx: WorldCtx): void {
  const { t } = getI18n();
  const env: DraftEnv = { index: ctx.index, toast: ctx.toast, t };
  const s = useRouteDraft.getState();
  if (!s.draft) s.newDraft(defaultRouteName(ctx.queryClient, ctx.worldId, t));
  if (useRouteDraft.getState().pickingStart) {
    s.setPickingStart(false);
    s.apply({ type: 'setStart', actor: item.name }, env);
    return;
  }
  s.apply({ type: 'click', actor: item.name }, env);
}

/**
 * The route planner (spec §10.6): sidebar panel, `route` map mode, the route on the map, the pods'
 * "Bring with you" list over the map, [+ Add to route], live updates.
 */
export const routesFeature: FeatureModule = {
  id: 'routes',
  sidebarPanels: [{ id: 'routes', order: 30, titleKey: 'routes.title', Component: RoutesPanel }],
  mapModes: [{ id: 'route', onMarkerClick: onRouteClick }],
  // After the selection pan (order 100), so a [Next stop ›] flight is not cut short by it.
  mapLayers: [{ id: 'route', order: 110, Component: RouteLayer }],
  mapOverlays: [{ id: 'pod-checklist', order: 10, Component: PodChecklistOverlay }],
  itemActions: [{ id: 'add-to-route', order: 20, Component: AddToRouteAction }],
  headerItems: [{ id: 'routes-host', order: 100, Component: RoutesHost }],
  sseHandlers: {
    routes: (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.routes(ctx.worldId) }); },
  },
};
