/** A spawner's position in the map container (px). */
export interface FocusPoint {
  id: string;
  x: number;
  y: number;
}

/** Height of a row of the keyboard order (px): spawners within one row are visited left to right. */
export const FOCUS_ROW_PX = 48;

/**
 * The spawners the keyboard visits, in reading order: those whose marker (radius `r`) lies wholly inside the map's
 * `width` × `height`, in rows of FOCUS_ROW_PX from the top, each row left to right. `keep` (the focused spawner)
 * stays in the list even when the map moved it out of view, so the focus is not lost.
 */
export function focusOrder(points: readonly FocusPoint[], width: number, height: number, r: number, keep: string | null = null): FocusPoint[] {
  return points
    .filter(p => p.id === keep || (p.x >= r && p.y >= r && p.x <= width - r && p.y <= height - r))
    .sort((a, b) => Math.floor(a.y / FOCUS_ROW_PX) - Math.floor(b.y / FOCUS_ROW_PX) || a.x - b.x || a.y - b.y);
}
