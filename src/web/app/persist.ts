import { COLLECTIBLE_TYPES } from '../../shared/collectibleTypes.js';
import { isTierKey, sortTierKeys, type TierKey } from '../../shared/machines.js';
import type { Locale } from '../../shared/i18n.js';
import { OCCUPANCIES, PURITIES, type Occupancy, type Purity } from '../../shared/resourceNodes.js';
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

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Not forgetting is fine too.
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

const LOCALE_KEY = 'ficsmap:locale';

/** The language picked in the header (per device), or null to follow the browser. */
export function loadLocale(): Locale | null {
  const raw = read(LOCALE_KEY);
  return raw === 'en' || raw === 'de' ? raw : null;
}

export function saveLocale(locale: Locale): void {
  write(LOCALE_KEY, locale);
}

const PANELS_KEY = 'ficsmap:panelsCollapsed';

/** Sidebar panels the user folded or unfolded (per device): panel id -> collapsed. */
export function loadPanelsCollapsed(): Record<string, boolean> {
  const raw = read(PANELS_KEY);
  if (raw === null) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, c]) => typeof c === 'boolean')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function savePanelsCollapsed(state: Record<string, boolean>): void {
  write(PANELS_KEY, JSON.stringify(state));
}

const SIDEBAR_WIDTH_KEY = 'ficsmap:sidebarWidth';

/** The sidebar width the user dragged to (per device), or null for "fit the content". */
export function loadSidebarWidth(): number | null {
  const raw = read(SIDEBAR_WIDTH_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function saveSidebarWidth(width: number | null): void {
  if (width === null) remove(SIDEBAR_WIDTH_KEY);
  else write(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
}

const podTicksKey = (worldId: string, routeId: string) => `ficsmap:podTicks:${worldId}:${routeId}`;

/** The items ticked in a saved route's "Bring with you" list (per device), by English name. */
export function loadPodTicks(worldId: string, routeId: string): Set<string> {
  const raw = read(podTicksKey(worldId, routeId));
  if (raw === null) return new Set();
  try {
    const data: unknown = JSON.parse(raw);
    return new Set(Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function savePodTicks(worldId: string, routeId: string, ticks: ReadonlySet<string>): void {
  if (ticks.size === 0) remove(podTicksKey(worldId, routeId));
  else write(podTicksKey(worldId, routeId), JSON.stringify([...ticks]));
}

const POD_CHECKLIST_COLLAPSED_KEY = 'ficsmap:podChecklistCollapsed';

/** Whether the "Bring with you" overlay was collapsed by hand (per device). */
export function loadPodChecklistCollapsed(): boolean {
  return read(POD_CHECKLIST_COLLAPSED_KEY) === '1';
}

export function savePodChecklistCollapsed(collapsed: boolean): void {
  if (collapsed) write(POD_CHECKLIST_COLLAPSED_KEY, '1');
  else remove(POD_CHECKLIST_COLLAPSED_KEY);
}

const RESOURCE_NODES_KEY = 'ficsmap:resourceNodes';

/**
 * The resource node layer per device: shown or not, the hidden resources (new ones start shown), the shown purities
 * and whether only nodes with (or without) an extractor show.
 */
export interface ResourceNodeView { visible: boolean; hiddenResources: string[]; purities: Purity[]; occupancy: Occupancy }

export function loadResourceNodeView(): ResourceNodeView {
  const view: ResourceNodeView = { visible: false, hiddenResources: [], purities: [...PURITIES], occupancy: 'all' };
  const raw = read(RESOURCE_NODES_KEY);
  if (raw === null) return view;
  let d: Record<string, unknown>;
  try {
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== 'object') return view;
    d = data as Record<string, unknown>;
  } catch {
    return view;
  }
  if (typeof d.visible === 'boolean') view.visible = d.visible;
  if (Array.isArray(d.hiddenResources)) view.hiddenResources = d.hiddenResources.filter((r): r is string => typeof r === 'string');
  if (Array.isArray(d.purities)) view.purities = PURITIES.filter(p => (d.purities as unknown[]).includes(p));
  if (OCCUPANCIES.includes(d.occupancy as Occupancy)) view.occupancy = d.occupancy as Occupancy;
  return view;
}

export function saveResourceNodeView(v: ResourceNodeView): void {
  write(RESOURCE_NODES_KEY, JSON.stringify(v));
}

const MACHINE_WIKI_TIERS_KEY = 'ficsmap:machineWikiTiers';

/** The machine wiki's unlock filter (per device): the selected tiers and groups; empty shows everything. */
export function loadMachineWikiTiers(): TierKey[] {
  const raw = read(MACHINE_WIKI_TIERS_KEY);
  if (raw === null) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? sortTierKeys(data.filter(isTierKey)) : [];
  } catch {
    return [];
  }
}

export function saveMachineWikiTiers(tiers: readonly TierKey[]): void {
  if (tiers.length === 0) remove(MACHINE_WIKI_TIERS_KEY);
  else write(MACHINE_WIKI_TIERS_KEY, JSON.stringify(tiers));
}
