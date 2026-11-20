import { create } from 'zustand';

/**
 * How long the timeline must rest before the slower views (the Fabrikplan panel in the sidebar) follow it, in ms.
 * Stepping by hand comes in bursts with pauses of about a second to look at the map in between; the panel should sit
 * still through those and catch up once the user is done. Updating the panel is cheap (analysis and lines of a
 * 3,800-building save take 30–60 ms), so the delay is about calm, not cost. Moving the pointer or the focus into the
 * panel catches it up at once.
 */
export const SETTLE_MS = 2000;

/** What holds the panel still regardless of time: the slider pressed, the timeline playing. */
export type TimelineHold = 'drag' | 'play';

/** The snapshot choice the slower views show. */
export interface SettledView {
  selectedId: number | null;
  compareId: number | null;
}

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
  /** The production line shown on the map (`ProductionLine.id`); null = none. */
  lineId: string | null;
  /**
   * The choice the Fabrikplan panel shows: `selectedId` and `compareId` once the timeline came to rest (no hold, no
   * timeline input for `SETTLE_MS`). Choices made elsewhere (the Fabrik page, a world switch) arrive at once.
   */
  settled: SettledView;
  /** Active holds (`TimelineHold`): while any is on, `settled` waits. */
  holds: readonly TimelineHold[];
  /** `input`: the choice comes from the timeline (a step, the slider, playing), so `settled` waits for the rest. */
  select(id: number | null, opts?: { input?: boolean }): void;
  compareWith(id: number | null): void;
  showOnMap(ids: readonly string[]): void;
  clearHighlight(): void;
  selectLine(id: string | null): void;
  /** Turns a hold on or off; letting go counts as timeline input (the rest starts then). */
  hold(reason: TimelineHold, on: boolean): void;
  /** Brings `settled` up to the current choice now (the user turned to the panel). */
  settle(): void;
  /** Back to the defaults (on leaving a world). */
  reset(): void;
}

const DEFAULTS = {
  selectedId: null, compareId: null, highlight: [] as readonly string[], highlightSeq: 0, lineId: null as string | null,
  settled: { selectedId: null, compareId: null } as SettledView, holds: [] as readonly TimelineHold[],
};

export const useFactoryView = create<FactoryViewState>((set, get) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Until when the timeline counts as in use (the last timeline input plus `SETTLE_MS`). */
  let busyUntil = 0;
  const settleNow = () => {
    clearTimeout(timer);
    timer = undefined;
    const { selectedId, compareId, settled } = get();
    if (settled.selectedId !== selectedId || settled.compareId !== compareId) set({ settled: { selectedId, compareId } });
  };
  /** After every change: catch up now, once the rest is over, or (held) not yet. */
  const follow = () => {
    clearTimeout(timer);
    timer = undefined;
    const { selectedId, compareId, settled, holds } = get();
    if (settled.selectedId === selectedId && settled.compareId === compareId) return;
    if (holds.length > 0) return;
    const wait = busyUntil - Date.now();
    if (wait <= 0) settleNow();
    else timer = setTimeout(settleNow, wait);
  };
  return {
    ...DEFAULTS,
    select: (id, opts) => {
      if (opts?.input) busyUntil = Date.now() + SETTLE_MS;
      set({ selectedId: id });
      follow();
    },
    compareWith: id => { set({ compareId: id }); follow(); },
    hold: (reason, on) => {
      const holds = get().holds;
      if (on === holds.includes(reason)) return;
      set({ holds: on ? [...holds, reason] : holds.filter(h => h !== reason) });
      if (!on) busyUntil = Date.now() + SETTLE_MS;
      follow();
    },
    settle: () => { busyUntil = 0; settleNow(); },
    showOnMap: ids => set(s => ({ highlight: [...ids], highlightSeq: s.highlightSeq + 1 })),
    clearHighlight: () => set({ highlight: [] }),
    selectLine: id => set({ lineId: id }),
    reset: () => {
      clearTimeout(timer);
      timer = undefined;
      busyUntil = 0;
      set(DEFAULTS);
    },
  };
});
