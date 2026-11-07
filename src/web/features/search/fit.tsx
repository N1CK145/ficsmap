import type L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { create } from 'zustand';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { prefersReducedMotion } from '../map/motion.js';

/** `[[south, west], [north, east]]` in map coordinates. */
export type MapBounds = [[number, number], [number, number]];

const FIT_PADDING: L.PointTuple = [24, 24];
/** A small area (a cave) is not zoomed in further than this; markers are full icons from zoom 2. */
const FIT_MAX_ZOOM = 5;

/**
 * A pending request to fit the map to an area (e.g. a cave chosen in the search). Search providers
 * call `fit()`; the map layer below carries it out, so code outside the map needs no map handle.
 */
export const useMapFit = create<{ request: MapBounds | null; fit(bounds: MapBounds): void; clear(): void }>()(set => ({
  request: null,
  fit: bounds => set({ request: bounds }),
  clear: () => set({ request: null }),
}));

/** `[[south, west], [north, east]]` around rings of `[lat, lng]` pairs, or null without points. */
export function boundsOf(rings: readonly (readonly (readonly [number, number])[])[]): MapBounds | null {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      south = Math.min(south, lat); north = Math.max(north, lat);
      west = Math.min(west, lng); east = Math.max(east, lng);
    }
  }
  return south === Infinity ? null : [[south, west], [north, east]];
}

/** Inside the map: fits the view to a requested area; on mobile the lower half is under the sheet. */
export function MapFitLayer() {
  const map = useMap();
  const mobile = useIsMobile();
  const request = useMapFit(s => s.request);
  useEffect(() => {
    if (!request) return;
    const [px, py] = FIT_PADDING;
    map.fitBounds(request, {
      paddingTopLeft: FIT_PADDING,
      paddingBottomRight: mobile ? [px, py + Math.round(map.getSize().y / 2)] : FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      animate: !prefersReducedMotion(),
    });
    useMapFit.getState().clear();
  }, [map, request, mobile]);
  return null;
}
