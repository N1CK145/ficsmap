import { useMemo } from 'react';
import { buildLines, type ProductionLines } from '../../../shared/factory/lines.js';
import type { SnapshotAnalysis } from './data.js';
import type { AnalysisData } from '../../../shared/factory/analysis.js';

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
    return buildLines(value.snapshot, value.analysis, data);
  }, [value, data]);
}
