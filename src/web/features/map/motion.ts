import type L from 'leaflet';

/** `prefers-reduced-motion: reduce` (spec §10.12): no fly-to animations and no pulses. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `map.flyTo`, or an instant `setView` when the user prefers reduced motion. Use it for every fly-to. */
export function flyToOrSet(map: L.Map, latlng: L.LatLngExpression, zoom: number): void {
  if (prefersReducedMotion()) map.setView(latlng, zoom, { animate: false });
  else map.flyTo(latlng, zoom);
}
