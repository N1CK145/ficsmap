/**
 * Every buildable and vehicle a save can hold, as the 2D factory map draws them: a dataset's `buildings.json` (dataset
 * part `buildings`, built by `scripts/buildings.ts` from the extractor's `buildings-raw.json` and the game's
 * `CommunityResources/Docs`). Keyed by class name without path, exactly as saves write it (`Build_ConstructorMk1_C`,
 * `BUILD_Potty_mk1_C`, `BP_Truck_C`); the factory snapshot (`src/shared/factory/snapshot.ts`) refers to these keys.
 *
 * Every value comes from the game files. What they do not have is left out or marked in `missing`.
 *
 * Units and frame: cm (game units), in the actor's own frame (x forward, y right, z up; yaw 0 = facing +x), so a box is
 * placed on the map by rotating it with the building's yaw and moving it to the building's position.
 */

export interface Names { en: string; de: string }

/**
 * What the map groups and colours buildings by. Derived from the class's native (C++) class and its name, see
 * `buildingCategory` in scripts/buildings.ts.
 */
export const BUILDING_CATEGORIES = [
  'production', 'extraction', 'power-gen', 'power-storage', 'power-pole', 'logistics-belt', 'logistics-pipe',
  'storage', 'transport', 'hypertube', 'structure', 'special', 'sign', 'other',
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export type Vec3 = [number, number, number];

/** An axis-aligned box in the actor's frame. */
export interface FootprintBox {
  min: Vec3;
  max: Vec3;
  /**
   * A soft clearance box (`CT_Soft`), which other buildables may overlap: all boxes of foundations, walls, ramps,
   * pillars and poles, and on machines the small extra boxes (chimneys, pipes on the roof). A machine's body is a box
   * without this flag.
   */
  soft?: true;
}

export interface Footprint {
  boxes: FootprintBox[];
  /**
   * `clearance`: the class's clearance boxes (`mClearanceData`), what the game uses to keep buildings apart.
   * `mesh`: the class has none; one box around its meshes instead (instance data and construction script meshes, a
   * vehicle's skeletal mesh, or for poles, lifts, passthroughs and the elevator the mesh at their base).
   */
  source: 'clearance' | 'mesh';
}

export type BuildingGap =
  /** No name in the game files; `name` is the class name. */
  | 'name'
  /** Only an English name in the game files (the class is not in the Docs); `name.de` is the English name. */
  | 'nameDe';

export interface BuildingEntry {
  name: Names;
  category: BuildingCategory;
  /**
   * Missing for classes the map draws from their own geometry instead (belts, pipes, hypertubes, railway tracks,
   * vehicle paths, power lines) and for the few without any box or mesh in the game files.
   */
  footprint?: Footprint;
  /**
   * Structural pieces (foundations, walls, ramps, pillars, walkways, ...): their grid size as the class sets it,
   * `mWidth`, `mDepth`, `mHeight` (pillars: `mSize`), and `mElevation` (how much a ramp rises). Only what the class has.
   */
  size?: { w?: number; d?: number; h?: number; elevation?: number };
  /** Picture: a descriptor class with a file in the dataset's `icons/items/` (see src/shared/icons.ts). */
  icon?: string;
  /**
   * For parts that no descriptor builds (the HUB's terminal, craft bench, storage and burner, sign poles, pipeline flow
   * indicators, ...): the classes that place them, according to the game files.
   */
  partOf?: string[];
  /** A vehicle (`BP_*`), not a buildable. */
  vehicle?: true;
  missing?: BuildingGap[];
}

export interface BuildingsFile {
  version: string;
  buildings: Record<string, BuildingEntry>;
}

export interface BuildingIndex {
  /** The entry of a class as a save names it; class names compare case-insensitively (saves write `BUILD_Potty_mk1_C`). */
  get(cls: string): BuildingEntry | undefined;
  /** Class names per category, sorted. */
  byCategory: Map<BuildingCategory, string[]>;
}

export function indexBuildings(file: BuildingsFile): BuildingIndex {
  const exact = new Map(Object.entries(file.buildings));
  const lower = new Map([...exact].map(([k, v]) => [k.toLowerCase(), v]));
  const byCategory = new Map<BuildingCategory, string[]>();
  for (const [cls, b] of [...exact].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))) {
    const list = byCategory.get(b.category) ?? [];
    list.push(cls);
    byCategory.set(b.category, list);
  }
  return {
    get: cls => exact.get(cls) ?? lower.get(cls.toLowerCase()),
    byCategory,
  };
}

/**
 * The 2D outline of a footprint: the bounding rectangle of its boxes in the actor's frame, or null without one. Soft
 * boxes count only when there is no other box (so a machine's chimney does not widen its outline, but a foundation,
 * whose boxes are all soft, keeps its own).
 */
export function footprintRect(b: Pick<BuildingEntry, 'footprint'>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const all = b.footprint?.boxes ?? [];
  const hard = all.filter(x => !x.soft);
  const boxes = hard.length > 0 ? hard : all;
  if (boxes.length === 0) return null;
  return {
    minX: Math.min(...boxes.map(x => x.min[0])),
    minY: Math.min(...boxes.map(x => x.min[1])),
    maxX: Math.max(...boxes.map(x => x.max[0])),
    maxY: Math.max(...boxes.map(x => x.max[1])),
  };
}
