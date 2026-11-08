import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { BuildingIndex } from '../../../../shared/buildings.js';
import type { AnalysisData, FactoryDiff } from '../../../../shared/factory/analysis.js';
import { buildLines, type ProductionLines } from '../../../../shared/factory/lines.js';
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
import { useFactoryMap, type FactorySelection } from './useFactoryMap.js';

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
  /** The game data of the analysis (recipes, machines, nodes): null without recipe data, undefined while it loads. */
  analysis: AnalysisData | null | undefined;
  /**
   * The shown snapshot's production lines: undefined while loading, null without analysis; no lines when the
   * snapshot has no `links` (imported before connections were read, see `hasLinks`).
   */
  lines: ProductionLines | null | undefined;
  /** The shown snapshot knows its belt and pipe connections (`FactorySnapshot.links`). */
  hasLinks: boolean;
}

/**
 * The same dataset parts: each component's `useFactoryData` makes its own `AnalysisData` (and maps of machines and
 * nodes) from the same cached parts, so the parts that arrive later are compared by presence.
 */
function sameData(a: AnalysisData, b: AnalysisData): boolean {
  return a === b || (a.recipes === b.recipes && a.buildings === b.buildings && !a.machines === !b.machines && !a.nodes === !b.nodes);
}

const linesCache = new WeakMap<FactorySnapshot, { data: AnalysisData; lines: ProductionLines }>();

/**
 * The production lines of an analysed snapshot, built once per snapshot and dataset (the map's layer, panel and info
 * window each read them; `useProductionLines` is the same per component).
 */
export function linesOf(value: SnapshotAnalysis, data: AnalysisData): ProductionLines {
  const hit = linesCache.get(value.snapshot);
  if (hit && sameData(hit.data, data)) return hit.lines;
  const lines = buildLines(value.snapshot, value.analysis, data);
  linesCache.set(value.snapshot, { data, lines });
  return lines;
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
  const analysisData = data?.analysis;
  const lines = useMemo(() => {
    if (current === null || analysisData === null) return null;
    if (!current || !analysisData) return undefined;
    return linesOf(current, analysisData);
  }, [current, analysisData]);
  const geometry = useMemo(() => (snapshot && compareQ.data ? geometryDiffOf(compareQ.data, snapshot) : null), [snapshot, compareQ.data]);
  // While the next snapshot downloads, the last one stays on the map (drawn faded).
  const last = useRef<Scene | null>(null);
  if (scene) last.current = scene;
  else if (!shown.isLoading) last.current = null;
  return {
    sel, snapshot, loading: shown.isLoading || (compareId !== null && compareQ.isLoading),
    scene: scene ?? last.current, current, compare: compareQ.data, diff, geometry, buildings, labels: data?.labels,
    recipes: data?.analysis?.recipes ?? null, analysis: data?.analysis,
    lines, hasLinks: (snapshot?.links?.length ?? 0) > 0,
  };
}

/**
 * Whether the selection is a machine (a building with production, not a station) the analysis knows or will know: it
 * opens as the machine window's popup (`MapMachinePopup`), not in the info window. Without recipe data there are no
 * figures for the machine window, so such a building stays in the info window.
 */
export function isMachine(data: Pick<MapData, 'scene' | 'analysis'>, sel: FactorySelection | null): boolean {
  if (sel?.kind !== 'building' || !data.scene || data.analysis === null) return false;
  return !!data.scene.byId.get(sel.id)?.b.prod && !data.scene.stationById.has(sel.id);
}

/**
 * Whether the selection opens as the storage popup (`MapMachinePopup` with `StorageWindow`): a crate, or a building with
 * a storage inventory (containers, storage boxes, fluid buffers, Dimensional Depot uploaders; not a station). Needs no
 * recipe data.
 */
export function isStorageSelection(data: Pick<MapData, 'scene'>, sel: FactorySelection | null): boolean {
  if (!data.scene || !sel) return false;
  if (sel.kind === 'crate') return data.scene.crateById.has(sel.id);
  if (sel.kind !== 'building') return false;
  return !!data.scene.byId.get(sel.id)?.b.inv && !data.scene.stationById.has(sel.id);
}

/** The selection opens in a popup next to it (a machine's window or a storage's), not in the info window. */
export function opensPopup(data: Pick<MapData, 'scene' | 'analysis'>, sel: FactorySelection | null): boolean {
  return isMachine(data, sel) || isStorageSelection(data, sel);
}
