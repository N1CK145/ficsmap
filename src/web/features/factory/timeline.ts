import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import type { MachineState, Reason } from '../../../shared/factory/analysis.js';
import type { SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { evictSnapshots, SNAPSHOT_KEEP_MS, useSnapshotList } from './api.js';
import { queryKeys } from '../../app/queryKeys.js';
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

/**
 * The world's timeline: its snapshot list resolved against the shared view (`settled`: against the choice the
 * Fabrikplan panel shows, which waits for the timeline to rest). `list` is undefined while it loads.
 */
export function useTimeline(worldId: string, settled = false): TimelineSelection & { list: SnapshotSummary[] | undefined; failed: boolean } {
  const q = useSnapshotList(worldId);
  const selectedId = useFactoryView(s => (settled ? s.settled.selectedId : s.selectedId));
  const compareId = useFactoryView(s => (settled ? s.settled.compareId : s.compareId));
  return { ...resolveTimeline(q.data, selectedId, compareId), list: q.data, failed: q.isError };
}

// --- Page-only state -------------------------------------------------------------------------------

export type MachineSort = 'productivity' | 'lost' | 'name' | 'clock';

interface FactoryPageState {
  worldId: string | null;
  /** Filters of the machine list. */
  cls: string | null;
  reason: Reason | null;
  /** A band or paused. */
  state: MachineState | null;
  sort: MachineSort;
  /** Items whose machines are unfolded in "Inefficient items". */
  expanded: string[];
  /** The production line whose diagram is shown (`ProductionLine.id`); null = the first. */
  line: string | null;
  /** The line diagram shows only machines (no splitters, mergers, pumps); null = only for large lines. */
  machinesOnly: boolean | null;
  enterWorld(worldId: string): void;
  setFilter(patch: Partial<Pick<FactoryPageState, 'cls' | 'reason' | 'state'>>): void;
  clearFilters(): void;
  setSort(sort: MachineSort): void;
  toggleItem(item: string): void;
  setLine(id: string | null): void;
  setMachinesOnly(on: boolean): void;
}

/** The factory page's own state (filters, sort, unfolded rows, the production line shown), kept while the map is shown; reset per world. */
export const useFactoryPage = create<FactoryPageState>()((set, get) => ({
  worldId: null,
  cls: null,
  reason: null,
  state: null,
  sort: 'productivity',
  expanded: [],
  line: null,
  machinesOnly: null,
  enterWorld: worldId => {
    if (get().worldId === worldId) return;
    set({ worldId, cls: null, reason: null, state: null, sort: 'productivity', expanded: [], line: null, machinesOnly: null });
  },
  setFilter: patch => set(patch),
  clearFilters: () => set({ cls: null, reason: null, state: null }),
  setSort: sort => set({ sort }),
  setLine: line => set({ line }),
  setMachinesOnly: on => set({ machinesOnly: on }),
  toggleItem: item => set(s => ({ expanded: s.expanded.includes(item) ? s.expanded.filter(i => i !== item) : [...s.expanded, item] })),
}));

/**
 * Binds the factory state to a world: entering another world resets the shared view (`view.ts`) and the page state,
 * so a snapshot id of one world is never looked up in another. Keeps the world's snapshot cache in bounds
 * (`useSnapshotRetention`).
 */
export function useFactoryWorld(worldId: string): void {
  useEffect(() => {
    const page = useFactoryPage.getState();
    if (page.worldId !== null && page.worldId !== worldId) useFactoryView.getState().reset();
    page.enterWorld(worldId);
  }, [worldId]);
  useSnapshotRetention(worldId);
}

/**
 * Downloaded snapshots stay cached while the timeline is in use: `SNAPSHOT_KEEP_MS` after its last use (any change of
 * the shown or compared save, letting go of the slider, stopping) the ones nothing shows are dropped, except the
 * shown save's neighbours (loaded for the next step). Never while the slider is held or the timeline plays. Leaving
 * the world drops them after the same time.
 */
export function useSnapshotRetention(worldId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const evict = () => {
      const v = useFactoryView.getState();
      const sel = resolveTimeline(qc.getQueryData<SnapshotSummary[]>(queryKeys.snapshots(worldId)), v.selectedId, v.compareId);
      const keep = new Set<number>();
      for (const s of [sel.ordered[sel.index - 1], sel.selected, sel.ordered[sel.index + 1], sel.compared]) if (s) keep.add(s.id);
      evictSnapshots(qc, worldId, keep);
    };
    const arm = () => {
      clearTimeout(timer);
      if (useFactoryView.getState().holds.length === 0) timer = setTimeout(evict, SNAPSHOT_KEEP_MS);
    };
    const unsubscribe = useFactoryView.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId || s.compareId !== prev.compareId || s.holds !== prev.holds) arm();
    });
    arm();
    return () => {
      unsubscribe();
      clearTimeout(timer);
      // Gone from this world: drop what nothing shows once the time is up (what still shows is never dropped).
      setTimeout(() => evictSnapshots(qc, worldId, new Set()), SNAPSHOT_KEEP_MS);
    };
  }, [qc, worldId]);
}
