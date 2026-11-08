import type { BuildingCategory } from '../../../shared/buildings.js';
import type { ClassChange, FactoryDiff } from '../../../shared/factory/analysis.js';

/**
 * One summary of what changed between two saves, for the Fabrik page's "Änderungen" and the factory map's timeline
 * counter, so both group the same way: machines, logistics, foundations (and anything else only when present).
 * Pure.
 */

export type DiffRowKey = 'machines' | 'logistics' | 'foundations' | 'other';

export interface DiffRow { key: DiffRowKey; added: number; removed: number }

/** Which row a building class counts in, by its `buildings.json` category. */
const ROW: Record<BuildingCategory, DiffRowKey> = {
  production: 'machines', extraction: 'machines', 'power-gen': 'machines',
  'logistics-belt': 'logistics', 'logistics-pipe': 'logistics', 'power-pole': 'logistics', hypertube: 'logistics', storage: 'logistics',
  transport: 'logistics', 'power-storage': 'logistics',
  structure: 'foundations',
  special: 'other', sign: 'other', other: 'other',
};

/** The row of a building class (unknown classes count as `other`). */
export function diffRowOf(cls: string, category: (cls: string) => BuildingCategory | undefined): DiffRowKey {
  const c = category(cls);
  return c ? ROW[c] : 'other';
}

/** What `diffSummary` adds besides buildings: floor pieces and belts, pipelines and roads (the map's `diffGeometry`). */
export interface GeometryCounts { floorAdded: number; floorRemoved: number; linesAdded: number; linesRemoved: number }

/**
 * Built and torn down per row: machines (production, extraction, generators), logistics (belts, pipelines and their
 * parts, poles, hypertubes, storage, stations and vehicles, and, with `geometry`, the belts, pipelines and roads
 * themselves), foundations (foundations, walls, ramps and the like, with `geometry` also the lightweight floor pieces);
 * `other` (signs, decorations, special buildings) only when something changed there. Rows without changes stay, so
 * the three main rows always read the same.
 */
export function diffSummary(
  diff: Pick<FactoryDiff, 'classes'>, category: (cls: string) => BuildingCategory | undefined, geometry?: GeometryCounts | null,
): DiffRow[] {
  const rows = new Map<DiffRowKey, DiffRow>((['machines', 'logistics', 'foundations', 'other'] as const).map(key => [key, { key, added: 0, removed: 0 }]));
  for (const c of diff.classes) {
    const r = rows.get(diffRowOf(c.cls, category))!;
    r.added += c.added;
    r.removed += c.removed;
  }
  if (geometry) {
    rows.get('logistics')!.added += geometry.linesAdded;
    rows.get('logistics')!.removed += geometry.linesRemoved;
    rows.get('foundations')!.added += geometry.floorAdded;
    rows.get('foundations')!.removed += geometry.floorRemoved;
  }
  const other = rows.get('other')!;
  return [...rows.values()].filter(r => r !== other || r.added + r.removed > 0);
}

/**
 * The class list of "Änderungen": the machines and other buildings (machines first, by category) and, folded below,
 * the logistics parts and foundations, by the same rows as `diffSummary`.
 */
export function splitClassChanges(classes: readonly ClassChange[], category: (cls: string) => BuildingCategory | undefined): { main: ClassChange[]; logistics: ClassChange[] } {
  const ORDER: BuildingCategory[] = ['production', 'extraction', 'power-gen', 'power-storage', 'storage', 'transport', 'special', 'sign', 'other'];
  const rank = (cls: string) => {
    const i = ORDER.indexOf(category(cls) ?? 'other');
    return i < 0 ? ORDER.length : i;
  };
  const main: ClassChange[] = [];
  const logistics: ClassChange[] = [];
  const folded = (cls: string) => {
    const c = category(cls);
    return c === 'logistics-belt' || c === 'logistics-pipe' || c === 'power-pole' || c === 'hypertube' || c === 'structure';
  };
  for (const c of classes) (folded(c.cls) ? logistics : main).push(c);
  main.sort((a, b) => rank(a.cls) - rank(b.cls) || (b.added + b.removed) - (a.added + a.removed) || a.cls.localeCompare(b.cls));
  return { main, logistics };
}
