import type L from 'leaflet';

/**
 * How far the map zooms in. The tiles go to zoom 5 and are scaled up beyond it; the collectible map stops at 7. A layer
 * that draws finer things (the factory map's machine sketches) asks for more while it is on (`DETAIL_MAX_ZOOM`), and
 * the map goes back to 7 when no layer asks any more.
 */
export const BASE_MAX_ZOOM = 7;
export const DETAIL_MAX_ZOOM = 10;

const requests = new Set<string>();

/** The max zoom right now: the detail zoom while any layer asks for it. */
export function currentMaxZoom(): number {
  return requests.size > 0 ? DETAIL_MAX_ZOOM : BASE_MAX_ZOOM;
}

/**
 * Asks for (`on`) or gives up the detail zoom under `key` and applies the result to `map` when given. A layer whose
 * switch is remembered as on asks before the map is created, so a remembered close-up view is not clamped to 7.
 */
export function requestDetailZoom(key: string, on: boolean, map?: L.Map): void {
  if (on) requests.add(key);
  else requests.delete(key);
  if (map && map.getMaxZoom() !== currentMaxZoom()) map.setMaxZoom(currentMaxZoom());
}

/**
 * The zoom of a first visit (no saved view) for a map of `width` × `height` px: the whole 256-unit image at the nearest
 * whole zoom, not the next lower one. Leaflet's fit with `zoomSnap` 1 rounds down, which left a 992 px high map with
 * a 512 px square at zoom 1; at zoom 2 (1024 px) the image's sea edge is cut by a few px instead.
 */
export function firstViewZoom(width: number, height: number): number {
  return Math.max(0, Math.round(Math.log2(Math.min(width, height) / 256)));
}
