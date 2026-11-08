import { create } from 'zustand';

/**
 * What the factory views share: the Fabrik page and the factory layers on the map read and set the same snapshot
 * choice, comparison and highlight, so "Auf der Karte" on the page shows exactly those buildings on the map, and
 * stepping the timeline on the map changes the page too.
 */
export interface FactoryViewState {
  /** The snapshot shown; null = the newest of the world's list. */
  selectedId: number | null;
  /** The snapshot compared against; null = no comparison. */
  compareId: number | null;
  /** Building ids (snapshot `SnapshotBuilding.id`, station or vehicle ids) to highlight and fit the map to. */
  highlight: readonly string[];
  /** Bumped on every `showOnMap`, so the map fits again even when the same ids are highlighted twice. */
  highlightSeq: number;
  select(id: number | null): void;
  compareWith(id: number | null): void;
  showOnMap(ids: readonly string[]): void;
  clearHighlight(): void;
  /** Back to the defaults (on leaving a world). */
  reset(): void;
}

const DEFAULTS = { selectedId: null, compareId: null, highlight: [] as readonly string[], highlightSeq: 0 };

export const useFactoryView = create<FactoryViewState>(set => ({
  ...DEFAULTS,
  select: id => set({ selectedId: id }),
  compareWith: id => set({ compareId: id }),
  showOnMap: ids => set(s => ({ highlight: [...ids], highlightSeq: s.highlightSeq + 1 })),
  clearHighlight: () => set({ highlight: [] }),
  reset: () => set(DEFAULTS),
}));
