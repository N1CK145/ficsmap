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
