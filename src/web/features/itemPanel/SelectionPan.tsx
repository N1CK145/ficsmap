import type L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { worldToLatLng } from '../../../shared/geo.js';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { prefersReducedMotion } from '../map/motion.js';
import { ITEM_SHEET_SHARE } from '../mobile/ItemSheet.js';

/** The item panel's width plus its margins: a selected marker must not end up under it. */
const PANEL_PADDING_PX = 360;

/** Room between a selected marker and the item sheet's top edge on mobile: the marker's own size and a margin. */
export const SHEET_MARGIN_PX = 32;

/** Zoom a "Show on map" request ends at least on: markers are full-size from there (DOT_ZOOM is 2). */
export const FOCUS_ZOOM = 4;

/**
 * Where the mobile item sheet begins, in viewport px: its measured top edge while it is shown, else where it will be
 * (it takes `ITEM_SHEET_SHARE` of the screen's height from the bottom).
 */
function itemSheetTop(): number {
  const sheet = document.querySelector('[data-item-sheet]');
  return sheet ? sheet.getBoundingClientRect().top : window.innerHeight * (1 - ITEM_SHEET_SHARE);
}

/**
 * The part of the map the item panel covers, as [right, bottom] px: the 340 px panel on the right on desktop; on
 * mobile the item sheet, from its real top edge to the map's bottom (the sheet sits on the screen's bottom, not the
 * map's), plus `SHEET_MARGIN_PX` so the whole marker stays clear of it.
 */
export function panelPadding(map: L.Map, mobile: boolean): L.PointTuple {
  if (!mobile) return [PANEL_PADDING_PX, 0];
  const mapBottom = map.getContainer().getBoundingClientRect().bottom;
  const covered = Math.max(0, Math.min(map.getSize().y, mapBottom - itemSheetTop()));
  return [0, Math.round(covered) + SHEET_MARGIN_PX];
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
