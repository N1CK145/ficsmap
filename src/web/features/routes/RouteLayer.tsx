import type { LatLngTuple } from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Polyline, useMap } from 'react-leaflet';
import { worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { centreBesidePanel, FOCUS_ZOOM } from '../itemPanel/SelectionPan.js';
import { flyToOrSet } from '../map/motion.js';
import { hasCaves, useCaves } from '../caves/useCaves.js';
import { routeLine, stopCaves, useRouteCaves } from './routeCaves.js';
import { useRouteDraft, useShownRoute } from './useRoutes.js';

/** The accent colour, read once from the CSS token so no colour is written down here. */
function readAccent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || 'currentColor';
}

/**
 * The shown route on the map (spec §10.6): a dashed orange line from the start through the stops
 * (the stop numbers are marker badges, see MapView), bending at the cave entrance a leg into or out of a cave
 * goes through. It also flies to the stop [Next stop ›] asks for (zoomed in to full markers, beside the item
 * panel; a jump with reduced motion). While a route is open it loads the dataset's caves for the planner
 * (`useRouteCaves`).
 */
export function RouteLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const { index } = ctx;
  const shown = useShownRoute(ctx.worldId);
  const focus = useRouteDraft(s => s.focus);
  const color = useMemo(readAccent, []);
  const mobile = useIsMobile();
  const routeOpen = useRouteDraft(s => s.draft !== null || s.activeRouteId !== null);
  const withCaves = useMemo(() => hasCaves(index), [index]);
  const shapes = useCaves(ctx.me.datasetVersion, index.ds.bounds, routeOpen && withCaves);
  const caves = useRouteCaves(s => s.caves);
  useEffect(() => {
    useRouteCaves.getState().setCaves(shapes ? stopCaves(index, shapes) : null);
  }, [shapes, index]);
  useEffect(() => () => useRouteCaves.getState().setCaves(null), []);

  const positions = useMemo((): LatLngTuple[] => {
    if (!shown || shown.start === null) return [];
    return routeLine([shown.start, ...shown.stops].flatMap(name => index.byName.get(name) ?? []), caves, index.ds.bounds);
  }, [shown, index, caves]);

  // Only requests made while the map is open; an old one does not fly on mount.
  const handled = useRef(focus?.n ?? 0);
  useEffect(() => {
    if (!focus || focus.n === handled.current) return;
    handled.current = focus.n;
    const item = index.byName.get(focus.actor);
    if (!item) return;
    const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
    flyToOrSet(map, centreBesidePanel(map, worldToLatLng(item.x, item.y, index.ds.bounds), zoom, mobile), zoom);
  }, [focus, index, map, mobile]);

  if (positions.length < 2) return null;
  return <Polyline positions={positions} interactive={false} pathOptions={{ color, weight: 3, opacity: 0.9, dashArray: '8 6' }} />;
}
