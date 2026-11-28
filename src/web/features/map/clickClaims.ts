/**
 * Layers drawn above the collectible markers (the resource nodes while they are shown) register a test here: a click
 * in the `inspect` mode on what such a layer shows at that container point is its own, so it does not also select the
 * marker hidden under it. The layer handles the click itself.
 */
export type ClickClaim = (x: number, y: number) => boolean;

export const markerClickClaims = new Set<ClickClaim>();

/** Whether a layer above the markers takes a click at this container point. */
export function clickClaimed(x: number, y: number): boolean {
  for (const claim of markerClickClaims) if (claim(x, y)) return true;
  return false;
}

/**
 * Layers drawn under the markers (the caves) register a handler here: it gets a click in the `inspect` mode that hit
 * no marker and that no layer above claimed (map coordinates and container point).
 */
export type BackgroundClick = (at: { lat: number; lng: number; x: number; y: number }) => void;

export const backgroundClicks = new Set<BackgroundClick>();
