import type { CollectedVisibility } from '../../app/store.js';

/** Marker states (spec §10.1). A conflict is a checked actor the last save import still saw. */
export type MarkerState = 'uncollected' | 'collected' | 'conflict';

/** `routeIndex`: the marker's place in the shown route, 0 for the start, null when not on it. */
export interface MarkerVisual {
  draw: boolean; opacity: number; dot: boolean; selected: boolean; routeIndex: number | null; badge: 'none' | 'conflict' | 'check';
  /** Drop pods: opened with power, or nothing needed; drawn while the pod is open. */
  pod?: 'power' | 'free';
  /** A match of the header search: drawn with a halo, above the other markers. */
  highlight?: boolean;
}

/** The badge a drop pod's requirement gets on the map (none for item pods and unknown data). */
export function podBadge(pod: { item: unknown; amount: number; power: number } | undefined): 'power' | 'free' | undefined {
  if (!pod) return undefined;
  const needsItem = pod.item !== null && pod.amount > 0;
  if (pod.power > 0 && !needsItem) return 'power';
  return !needsItem && pod.power <= 0 ? 'free' : undefined;
}

/** Below this zoom markers are dots and a click zooms in (spec §10.1). */
export const DOT_ZOOM = 2;
const DIM_OPACITY = 0.35;
const OUT_OF_SCOPE_FACTOR = 0.2;
/** Markers that do not match an active search fade like markers outside the biome scope. */
const NO_MATCH_FACTOR = 0.2;

export function markerState(collected: boolean, mismatch: boolean): MarkerState {
  if (!collected) return 'uncollected';
  return mismatch ? 'conflict' : 'collected';
}

/**
 * How one marker looks (spec §10.1, §10.3, §10.4). Filtered types are never drawn; conflicts ignore
 * Hide and Dim, so they stay visible until resolved; "only conflicts" hides everything else.
 * `search`: null without an active search, else whether the marker matches it. A match is drawn
 * whatever the filters say (the user asked for it) and gets a halo; the rest fades.
 */
export function markerVisual(s: MarkerState, o: {
  visibility: CollectedVisibility; zoom: number; selected: boolean; inScope: boolean; typeEnabled: boolean; onlyConflicts: boolean; routeIndex: number | null;
  search?: boolean | null;
}): MarkerVisual {
  const match = o.search === true;
  const draw = match || (o.typeEnabled
    && (!o.onlyConflicts || s === 'conflict')
    && !(o.visibility === 'hide' && s === 'collected'));
  const base = s === 'collected' && o.visibility === 'dim' ? DIM_OPACITY : 1;
  const scoped = o.inScope ? base : base * OUT_OF_SCOPE_FACTOR;
  return {
    draw,
    opacity: o.search === false ? scoped * NO_MATCH_FACTOR : scoped,
    highlight: match,
    dot: o.zoom < DOT_ZOOM,
    selected: o.selected,
    routeIndex: o.routeIndex,
    badge: s === 'conflict' ? 'conflict' : s === 'collected' ? 'check' : 'none',
  };
}
