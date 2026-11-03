import type { LatLngBoundsLiteral } from 'leaflet';

/** The zoom-0 image is 256 × 256 in CRS.Simple (shared/geo.ts): `[[south, west], [north, east]]`. */
export const IMAGE_BOUNDS: LatLngBoundsLiteral = [[-256, 0], [0, 256]];

/** The image's corners as a ring of `[lat, lng]` pairs. */
export const IMAGE_RING: [lat: number, lng: number][] = [[-256, 0], [-256, 256], [0, 256], [0, 0]];
