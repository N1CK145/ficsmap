import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { BuildingIndex } from '../../../../shared/buildings.js';
import type { FactoryDiff } from '../../../../shared/factory/analysis.js';
import type { FactorySnapshot } from '../../../../shared/factory/snapshot.js';
import type { RecipeIndex } from '../../../../shared/recipes.js';
import type { WorldBounds } from '../../../../shared/types.js';
import { queryKeys } from '../../../app/queryKeys.js';
import { fetchSnapshot, useSnapshot } from '../api.js';
import { useBuildings, useFactoryData, useFactoryDiff, useSnapshotAnalysis, type FactoryLabels, type SnapshotAnalysis } from '../data.js';
import { useTimeline, type TimelineSelection } from '../timeline.js';
import { useFactoryView } from '../view.js';
import { geometryDiffOf, type GeometryDiff } from './diff.js';
import { sceneOf, type Scene } from './scene.js';
import { useFactoryMap } from './useFactoryMap.js';

/**
 * Keeps the comparison on "the save before" while that is the mode: whenever the shown snapshot changes with changes
 * marked, the compared one follows (none for the oldest).
 */
export function useFollowPrevious(sel: TimelineSelection): void {
  const compareMode = useFactoryMap(s => s.compareMode);
  const compareSet = useFactoryView(s => s.compareId) !== null;
  useEffect(() => {
    if (!compareSet || compareMode !== 'previous' || sel.index < 0) return;
    const prev = sel.ordered[sel.index - 1]?.id ?? null;
    if (useFactoryView.getState().compareId !== prev) useFactoryView.getState().compareWith(prev);
  }, [compareSet, compareMode, sel.index, sel.ordered]);
}

/** Loads the neighbours of the shown snapshot in the background, so stepping the timeline is instant. */
export function usePrefetchNeighbours(worldId: string, sel: TimelineSelection, enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || sel.index < 0) return;
    for (const s of [sel.ordered[sel.index - 1], sel.ordered[sel.index + 1]]) {
      if (!s) continue;
      void qc.prefetchQuery({ queryKey: queryKeys.snapshot(worldId, s.id), queryFn: () => fetchSnapshot(worldId, s.id), staleTime: Infinity });
    }
  }, [qc, worldId, sel.index, sel.ordered, enabled]);
}

export interface MapData {
  /** The world's timeline (the factory page's, `timeline.ts`); `list` undefined while it loads. */
  sel: ReturnType<typeof useTimeline>;
  snapshot: FactorySnapshot | undefined;
  /** The shown snapshot (or the compared one) is still downloading; the last scene stays meanwhile. */
  loading: boolean;
  scene: Scene | null;
  /** The shown snapshot's analysis (the page's): undefined while loading, null without recipe data or snapshot. */
  current: SnapshotAnalysis | null | undefined;
  compare: FactorySnapshot | undefined;
  /** Buildings and productivity changes (the page's `diffFactory`); floor pieces and lines (the map's own). */
  diff: FactoryDiff | null;
  geometry: GeometryDiff | null;
  buildings: BuildingIndex | null | undefined;
  labels: FactoryLabels | undefined;
  /** Recipe names (null without recipe data). */
  recipes: RecipeIndex | null;
}

/**
 * Everything the factory map draws: the shown snapshot as a scene (with the page's analysis for the reasons), and,
 * while changes are marked, the diff against the compared one. Snapshots and dataset parts load only while `enabled`.
 */
export function useMapData(worldId: string, version: string, bounds: WorldBounds | undefined, enabled: boolean): MapData {
  const sel = useTimeline(worldId);
  useFollowPrevious(sel);
  usePrefetchNeighbours(worldId, sel, enabled);
  const buildings = useBuildings(version, enabled);
  const data = useFactoryData(version, worldId);
  const shownId = enabled ? sel.selected?.id ?? null : null;
  const compareId = enabled ? sel.compared?.id ?? null : null;
  const shown = useSnapshot(worldId, shownId);
  const compareQ = useSnapshot(worldId, compareId);
  const current = useSnapshotAnalysis(worldId, shownId, data?.analysis).value;
  const compared = useSnapshotAnalysis(worldId, compareId, data?.analysis).value;
  const diff = useFactoryDiff(compared, current);
  const snapshot = shown.data;
  const analysis = current?.analysis ?? null;
  const routes = current?.routes ?? null;
  const scene = useMemo(
    () => (snapshot && buildings && bounds ? sceneOf(snapshot, buildings, bounds, analysis, routes) : null),
    [snapshot, buildings, bounds, analysis, routes],
  );
  const geometry = useMemo(() => (snapshot && compareQ.data ? geometryDiffOf(compareQ.data, snapshot) : null), [snapshot, compareQ.data]);
  // While the next snapshot downloads, the last one stays on the map (drawn faded).
  const last = useRef<Scene | null>(null);
  if (scene) last.current = scene;
  else if (!shown.isLoading) last.current = null;
  return {
    sel, snapshot, loading: shown.isLoading || (compareId !== null && compareQ.isLoading),
    scene: scene ?? last.current, current, compare: compareQ.data, diff, geometry, buildings, labels: data?.labels,
    recipes: data?.analysis?.recipes ?? null,
  };
}
