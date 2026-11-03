import { COLLECTIBLE_TYPES } from '../../../shared/collectibleTypes.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import type { ExtractResult } from '../../../shared/extract.js';
import type { CollectibleTypeId } from '../../../shared/types.js';
import { isCollected, type MarksCache } from '../marks/useMarks.js';

export interface ImportPreview {
  recognised: number;
  /** In the save, not checked yet: the import checks them. */
  willCheck: number;
  /** Checked, in the dataset, not in the save: they stay checked and get (!). */
  conflicts: number;
  /** The save is from a newer game build than the dataset. */
  buildNewer: boolean;
  /** The save matches nothing while the world has checks: importing would flag every one (Review Focus 1). */
  needsSecondConfirm: boolean;
}

/** Every actor the user sees as checked: stored marks and pending checks, minus pending unchecks. */
function checkedActors(cache: MarksCache): string[] {
  const actors = new Set([...cache.marks.keys(), ...cache.pending.keys()]);
  return [...actors].filter(a => isCollected(cache, a));
}

/** What an import would do, per the §7 table, against what the user currently sees. */
export function computePreview(r: ExtractResult, cache: MarksCache, index: DatasetIndex): ImportPreview {
  const inSave = new Set(r.collected.filter(n => index.has(n)));
  const checked = checkedActors(cache).filter(a => index.has(a));
  const checkedSet = new Set(checked);
  return {
    recognised: r.recognised,
    willCheck: [...inSave].filter(n => !checkedSet.has(n)).length,
    conflicts: checked.filter(a => !inSave.has(a)).length,
    buildNewer: r.meta.build > index.ds.build,
    needsSecondConfirm: r.recognised === 0 && checked.length > 0,
  };
}

/** Recognised items per type, in registry order; types without any are left out. */
export function countByType(collected: readonly string[], index: DatasetIndex): [CollectibleTypeId, number][] {
  const counts = new Map<CollectibleTypeId, number>();
  for (const n of collected) {
    const type = index.byName.get(n)?.type;
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return COLLECTIBLE_TYPES.flatMap(t => {
    const c = counts.get(t.id);
    return c ? [[t.id, c] as [CollectibleTypeId, number]] : [];
  });
}
