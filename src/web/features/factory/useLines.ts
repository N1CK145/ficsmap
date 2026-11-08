import { useMemo } from 'react';
import type { AnalysisData, FactoryAnalysis } from '../../../shared/factory/analysis.js';
import { buildLines, type ProductionLines } from '../../../shared/factory/lines.js';
import type { SnapshotAnalysis } from './data.js';

/** Lines per analysis (one per snapshot): the page's sections and the figures share one build. */
const cache = new WeakMap<FactoryAnalysis, WeakMap<AnalysisData, ProductionLines>>();

/** The production lines of an analysed snapshot, built once per analysis and data. */
export function linesOf(value: SnapshotAnalysis, data: AnalysisData): ProductionLines {
  let perData = cache.get(value.analysis);
  if (!perData) cache.set(value.analysis, (perData = new WeakMap()));
  let lines = perData.get(data);
  if (!lines) perData.set(data, (lines = buildLines(value.snapshot, value.analysis, data)));
  return lines;
}

/**
 * The production lines of an analysed snapshot (from `useSnapshotAnalysis`), shared by the map's hover and the line
 * diagram. undefined while loading, null without a snapshot.
 */
export function useProductionLines(
  value: SnapshotAnalysis | null | undefined, data: AnalysisData | null | undefined,
): ProductionLines | null | undefined {
  return useMemo(() => {
    if (value === null) return null;
    if (!value || !data) return undefined;
    return linesOf(value, data);
  }, [value, data]);
}
