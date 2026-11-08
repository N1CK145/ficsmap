import { useEffect } from 'react';
import { create } from 'zustand';
import type { Band, Reason } from '../../../shared/factory/analysis.js';
import type { SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { useSnapshotList } from './api.js';
import { useFactoryView } from './view.js';

export interface TimelineSelection {
  /** The world's snapshots, oldest save first. */
  ordered: SnapshotSummary[];
  selected: SnapshotSummary | null;
  /** Index of `selected` in `ordered`, -1 without. */
  index: number;
  /** The snapshot compared against (null: no comparison, or the chosen one is gone). */
  compared: SnapshotSummary | null;
}

/**
 * Resolves the shared view's choice (`view.ts`) against the world's snapshot list (newest first, as the server sends
 * it): the selected snapshot (the newest when none is chosen or the chosen one is gone) and the compared one (never
 * the selected one itself).
 */
export function resolveTimeline(list: readonly SnapshotSummary[] | undefined, selectedId: number | null, compareId: number | null): TimelineSelection {
  const ordered = [...(list ?? [])].sort((a, b) => a.saveTime - b.saveTime || a.id - b.id);
  let index = selectedId === null ? -1 : ordered.findIndex(s => s.id === selectedId);
  if (index < 0) index = ordered.length - 1;
  const selected = ordered[index] ?? null;
  const compared = compareId !== null && compareId !== selected?.id ? ordered.find(s => s.id === compareId) ?? null : null;
  return { ordered, selected, index, compared };
}

/** The neighbour of the selected snapshot (`step` -1 older, +1 newer), or null at that end of the timeline. */
export function stepId(sel: TimelineSelection, step: -1 | 1): number | null {
  return sel.ordered[sel.index + step]?.id ?? null;
}

/** What "Compare with" picks by default: the snapshot before the selected one, else the one after it. */
export function defaultCompareId(sel: TimelineSelection): number | null {
  return sel.ordered[sel.index - 1]?.id ?? sel.ordered[sel.index + 1]?.id ?? null;
}

/** The world's timeline: its snapshot list resolved against the shared view. `list` is undefined while it loads. */
export function useTimeline(worldId: string): TimelineSelection & { list: SnapshotSummary[] | undefined; failed: boolean } {
  const q = useSnapshotList(worldId);
  const selectedId = useFactoryView(s => s.selectedId);
  const compareId = useFactoryView(s => s.compareId);
  return { ...resolveTimeline(q.data, selectedId, compareId), list: q.data, failed: q.isError };
}

// --- Page-only state -------------------------------------------------------------------------------

export type MachineSort = 'productivity' | 'lost' | 'name' | 'clock';

interface FactoryPageState {
  worldId: string | null;
  /** Filters of the machine list. */
  cls: string | null;
  reason: Reason | null;
  band: Band | null;
  sort: MachineSort;
  /** Items whose machines are unfolded in "Inefficient items". */
  expanded: string[];
  enterWorld(worldId: string): void;
  setFilter(patch: Partial<Pick<FactoryPageState, 'cls' | 'reason' | 'band'>>): void;
  clearFilters(): void;
  setSort(sort: MachineSort): void;
  toggleItem(item: string): void;
}

/** The factory page's own state (filters, sort, unfolded rows), kept while the map is shown; reset per world. */
export const useFactoryPage = create<FactoryPageState>()((set, get) => ({
  worldId: null,
  cls: null,
  reason: null,
  band: null,
  sort: 'productivity',
  expanded: [],
  enterWorld: worldId => {
    if (get().worldId === worldId) return;
    set({ worldId, cls: null, reason: null, band: null, sort: 'productivity', expanded: [] });
  },
  setFilter: patch => set(patch),
  clearFilters: () => set({ cls: null, reason: null, band: null }),
  setSort: sort => set({ sort }),
  toggleItem: item => set(s => ({ expanded: s.expanded.includes(item) ? s.expanded.filter(i => i !== item) : [...s.expanded, item] })),
}));

/**
 * Binds the factory state to a world: entering another world resets the shared view (`view.ts`) and the page state,
 * so a snapshot id of one world is never looked up in another.
 */
export function useFactoryWorld(worldId: string): void {
  useEffect(() => {
    const page = useFactoryPage.getState();
    if (page.worldId !== null && page.worldId !== worldId) useFactoryView.getState().reset();
    page.enterWorld(worldId);
  }, [worldId]);
}
