import { create } from 'zustand';
import { COLLECTIBLE_TYPES } from '../../shared/collectibleTypes.js';
import type { CollectibleTypeId } from '../../shared/types.js';
import type { PersistedView } from './persist.js';

export type InteractionMode = 'inspect' | 'route';
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
  sidebarOpen: boolean;
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
  /** Map modes are exclusive; setting the active mode again returns to 'inspect'. */
  setMode(m: InteractionMode): void;
  select(a: string | null): void;
  toggleType(id: CollectibleTypeId): void;
  showOnlyType(id: CollectibleTypeId): void;
  setTypeFilter(ids: Iterable<CollectibleTypeId>): void;
  setVisibility(v: CollectedVisibility): void;
  setBiomeScope(biome: number | null): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  setOnlyConflicts(on: boolean): void;
  setMainView(v: MainView): void;
  /** Resets the per-world state for `worldId`, then applies its remembered filters (map viewport is the map's job). */
  enterWorld(worldId: string, view?: Partial<PersistedView>): void;
}

type WorldState = Pick<UiState, 'worldId' | 'interactionMode' | 'selectedActor' | 'typeFilter' | 'visibility' | 'biomeScope' | 'onlyConflicts' | 'mainView' | 'selfLeaving' | 'focusRequest' | 'searchHighlight'>;

function worldState(worldId: string | null, view: Partial<PersistedView> = {}): WorldState {
  return {
    worldId,
    interactionMode: 'inspect',
    selectedActor: null,
    typeFilter: new Set(view.typeFilter ?? COLLECTIBLE_TYPES.map(t => t.id)),
    visibility: view.visibility ?? 'dim',
    biomeScope: view.biomeScope ?? null,
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
  setMode: m => set(s => ({ interactionMode: s.interactionMode === m ? 'inspect' : m })),
  select: a => set({ selectedActor: a }),
  toggleType: id => set(s => {
    const next = new Set(s.typeFilter);
    if (!next.delete(id)) next.add(id);
    return { typeFilter: next };
  }),
  showOnlyType: id => set({ typeFilter: new Set([id]) }),
  setTypeFilter: ids => set({ typeFilter: new Set(ids) }),
  setVisibility: v => set({ visibility: v }),
  setBiomeScope: biome => set({ biomeScope: biome }),
  setSidebarOpen: open => set({ sidebarOpen: open }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setOnlyConflicts: on => set({ onlyConflicts: on }),
  setMainView: v => set({ mainView: v }),
  setSelfLeaving: worldId => set({ selfLeaving: worldId }),
  focusItem: actor => set({ mainView: 'map', selectedActor: actor, focusRequest: { actor } }),
  clearFocusRequest: () => set({ focusRequest: null }),
  setSearchHighlight: actors => set({ searchHighlight: actors }),
  enterWorld: (worldId, view) => set(worldState(worldId, view)),
}));
