import { create } from 'zustand';
import { COLLECTIBLE_TYPES } from '../../shared/collectibleTypes.js';
import type { CollectibleTypeId } from '../../shared/types.js';
import { loadMarkersVisible, saveMarkersVisible, type PersistedView } from './persist.js';

/** 'route': editing a route (routes feature); 'vehicle-route': picking a vehicle route's ends (vehicleCalc feature). */
export type InteractionMode = 'inspect' | 'route' | 'vehicle-route';
export type CollectedVisibility = 'show' | 'dim' | 'hide';
export type MainView = 'map' | 'list';

export interface UiState {
  /** The world the per-world state below belongs to; null before the first world is entered. */
  worldId: string | null;
  interactionMode: InteractionMode;
  selectedActor: string | null;
  typeFilter: Set<CollectibleTypeId>;
  visibility: CollectedVisibility;
  biomeScope: number | null;
  /**
   * A pending request for the map to fit the view to this biome: set with the scope, not for a scope restored with
   * the view. The biome layer carries it out once the map is shown and clears it.
   */
  biomeFitRequest: number | null;
  sidebarOpen: boolean;
  /**
   * Whether the map draws the collectible markers at all (the "Collectibles" layer switch; per device, not per world).
   * Off, the map neither draws nor hit-tests them; the sidebar, the list view and the item panel work as before.
   * Selecting an item, `focusItem` and the route mode switch it back on: they are about a marker on the map.
   */
  markersVisible: boolean;
  onlyConflicts: boolean;
  /** What the main area shows: the map or the list view (spec §10.10). Not remembered; the map restores its own viewport. */
  mainView: MainView;
  /** Set while the user's own leave/delete of this world is in flight, so the server's broadcast of it is not handled as "someone else did it". */
  selfLeaving: string | null;
  /** A pending request for the map to bring an item into view (list view's Show on map); the map clears it. */
  focusRequest: { actor: string } | null;
  /**
   * The items the header search highlights on the map (the others are dimmed), or null while no
   * search with item results is active. Matches are drawn even when the filters would hide them.
   */
  searchHighlight: ReadonlySet<string> | null;
  setSearchHighlight(actors: ReadonlySet<string> | null): void;
  setSelfLeaving(worldId: string | null): void;
  /** Selects the item, shows the map and asks it to zoom to the item (spec §10.10). */
  focusItem(actor: string): void;
  clearFocusRequest(): void;
  /** Map modes are exclusive; setting the active mode again returns to 'inspect'. The route mode shows the markers (its stops are markers). */
  setMode(m: InteractionMode): void;
  /** Selects an item (showing the markers) or clears the selection. */
  select(a: string | null): void;
  toggleMarkers(): void;
  showMarkers(): void;
  toggleType(id: CollectibleTypeId): void;
  showOnlyType(id: CollectibleTypeId): void;
  setTypeFilter(ids: Iterable<CollectibleTypeId>): void;
  setVisibility(v: CollectedVisibility): void;
  setBiomeScope(biome: number | null): void;
  clearBiomeFitRequest(): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  setOnlyConflicts(on: boolean): void;
  setMainView(v: MainView): void;
  /** Resets the per-world state for `worldId`, then applies its remembered filters (map viewport is the map's job). */
  enterWorld(worldId: string, view?: Partial<PersistedView>): void;
}

type WorldState = Pick<UiState, 'worldId' | 'interactionMode' | 'selectedActor' | 'typeFilter' | 'visibility' | 'biomeScope' | 'biomeFitRequest' | 'onlyConflicts' | 'mainView' | 'selfLeaving' | 'focusRequest' | 'searchHighlight'>;

function worldState(worldId: string | null, view: Partial<PersistedView> = {}): WorldState {
  return {
    worldId,
    interactionMode: 'inspect',
    selectedActor: null,
    typeFilter: new Set(view.typeFilter ?? COLLECTIBLE_TYPES.map(t => t.id)),
    visibility: view.visibility ?? 'dim',
    biomeScope: view.biomeScope ?? null,
    biomeFitRequest: null,
    onlyConflicts: false,
    mainView: 'map',
    selfLeaving: null,
    focusRequest: null,
    searchHighlight: null,
  };
}

export const useUiStore = create<UiState>()(set => ({
  ...worldState(null),
  sidebarOpen: true,
  markersVisible: loadMarkersVisible(),
  setMode: m => set(s => {
    const interactionMode = s.interactionMode === m ? 'inspect' : m;
    return interactionMode === 'route' ? { interactionMode, markersVisible: true } : { interactionMode };
  }),
  select: a => set(a === null ? { selectedActor: null } : { selectedActor: a, markersVisible: true }),
  toggleMarkers: () => set(s => ({ markersVisible: !s.markersVisible })),
  showMarkers: () => set({ markersVisible: true }),
  toggleType: id => set(s => {
    const next = new Set(s.typeFilter);
    if (!next.delete(id)) next.add(id);
    return { typeFilter: next };
  }),
  showOnlyType: id => set({ typeFilter: new Set([id]) }),
  setTypeFilter: ids => set({ typeFilter: new Set(ids) }),
  setVisibility: v => set({ visibility: v }),
  setBiomeScope: biome => set({ biomeScope: biome, biomeFitRequest: biome }),
  clearBiomeFitRequest: () => set({ biomeFitRequest: null }),
  setSidebarOpen: open => set({ sidebarOpen: open }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setOnlyConflicts: on => set({ onlyConflicts: on }),
  setMainView: v => set({ mainView: v }),
  setSelfLeaving: worldId => set({ selfLeaving: worldId }),
  focusItem: actor => set({ mainView: 'map', selectedActor: actor, focusRequest: { actor }, markersVisible: true }),
  clearFocusRequest: () => set({ focusRequest: null }),
  setSearchHighlight: actors => set({ searchHighlight: actors }),
  enterWorld: (worldId, view) => set(worldState(worldId, view)),
}));

// Remembered per device, whatever switched it (the layer switch or an action that needs the markers).
useUiStore.subscribe((s, prev) => {
  if (s.markersVisible !== prev.markersVisible) saveMarkersVisible(s.markersVisible);
});
