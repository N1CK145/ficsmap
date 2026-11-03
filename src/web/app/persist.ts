import { COLLECTIBLE_TYPES } from '../../shared/collectibleTypes.js';
import type { CollectibleTypeId } from '../../shared/types.js';
import type { CollectedVisibility } from './store.js';

/** What the map remembers per world and device (spec §10). */
export interface PersistedView {
  center: [number, number];
  zoom: number;
  typeFilter: CollectibleTypeId[];
  visibility: CollectedVisibility;
  biomeScope: number | null;
}

const viewKey = (worldId: string) => `ficsmap:view:${worldId}`;
const LAST_WORLD_KEY = 'ficsmap:lastWorld';
const TYPE_IDS: ReadonlySet<string> = new Set(COLLECTIBLE_TYPES.map(t => t.id));
const VISIBILITIES: ReadonlySet<string> = new Set<CollectedVisibility>(['show', 'dim', 'hide']);

// Storage can be missing, blocked or full (private mode, quota). Remembering is best effort.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering is fine.
  }
}

/** The stored view for a world, keeping only fields that are still valid. */
export function loadView(worldId: string): Partial<PersistedView> | null {
  const raw = read(viewKey(worldId));
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const view: Partial<PersistedView> = {};
  if (Array.isArray(d.center) && d.center.length === 2 && d.center.every(Number.isFinite)) {
    view.center = [d.center[0] as number, d.center[1] as number];
  }
  if (Number.isFinite(d.zoom)) view.zoom = d.zoom as number;
  if (Array.isArray(d.typeFilter)) {
    view.typeFilter = d.typeFilter.filter((t): t is CollectibleTypeId => typeof t === 'string' && TYPE_IDS.has(t));
  }
  if (typeof d.visibility === 'string' && VISIBILITIES.has(d.visibility)) view.visibility = d.visibility as CollectedVisibility;
  if (d.biomeScope === null || (Number.isInteger(d.biomeScope) && (d.biomeScope as number) >= 0)) {
    view.biomeScope = d.biomeScope as number | null;
  }
  return view;
}

export function saveView(worldId: string, v: PersistedView): void {
  write(viewKey(worldId), JSON.stringify(v));
}

export function lastWorld(): string | null {
  return read(LAST_WORLD_KEY);
}

export function setLastWorld(id: string): void {
  write(LAST_WORLD_KEY, id);
}

const SIDEBAR_WIDTH_KEY = 'ficsmap:sidebarWidth';

/** The sidebar width the user dragged to (per device), or null for "fit the content". */
export function loadSidebarWidth(): number | null {
  const raw = read(SIDEBAR_WIDTH_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function saveSidebarWidth(width: number | null): void {
  if (width === null) {
    try {
      localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    } catch {
      // Not remembering is fine.
    }
  } else write(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
}
