import type L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { prefersReducedMotion } from '../map/motion.js';

/** The item panel's width plus its margins: a selected marker must not end up under it. */
const PANEL_PADDING_PX = 360;

/** Zoom a "Show on map" request ends at least on: markers are full-size from there (DOT_ZOOM is 2). */
export const FOCUS_ZOOM = 4;

/**
 * The part of the map the item panel covers, as [right, bottom] px: the 340 px panel on the right
 * on desktop, the half-height item sheet at the bottom on mobile.
 */
export function panelPadding(map: L.Map, mobile: boolean): L.PointTuple {
  return mobile ? [0, Math.round(map.getSize().y / 2)] : [PANEL_PADDING_PX, 0];
}

/** The map centre that puts `latlng` in the middle of the part of the map the item panel leaves free. */
export function centreBesidePanel(map: L.Map, latlng: L.LatLngExpression, zoom: number, mobile: boolean): L.LatLng {
  const [right, bottom] = panelPadding(map, mobile);
  return map.unproject(map.project(latlng, zoom).add([right / 2, bottom / 2]), zoom);
}

/** A map layer that pans a newly selected marker out from under the item panel (spec §10.2). */
export function SelectionPan({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const mobile = useIsMobile();
  const selected = useUiStore(s => s.selectedActor);
  const focus = useUiStore(s => s.focusRequest);
  const { index } = ctx;
  // List view's "Show on map": centre the item in the part of the map the item panel leaves free.
  useEffect(() => {
    if (!focus) return;
    const item = index.byName.get(focus.actor);
    if (item) {
      const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
      const centre = centreBesidePanel(map, worldToLatLng(item.x, item.y, index.ds.bounds), zoom, mobile);
      map.setView(centre, zoom, { animate: !prefersReducedMotion() });
    }
    useUiStore.getState().clearFocusRequest();
  }, [map, index, focus, mobile]);
  useEffect(() => {
    const item = selected === null ? undefined : index.byName.get(selected);
    if (!item) return;
    map.panInside(worldToLatLng(item.x, item.y, index.ds.bounds), {
      paddingTopLeft: [0, 0], paddingBottomRight: panelPadding(map, mobile), animate: !prefersReducedMotion(),
    });
  }, [map, index, selected, mobile]);
  return null;
}
