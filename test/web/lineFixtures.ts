import type { LineGroup, ProductionLine, ProductionLines } from '../../src/shared/factory/lines.js';

/**
 * Two production lines as `buildLines` describes them, for the line diagram: iron plates (2 smelters → merger → 3
 * constructors → storage, the merger's overflow into the storage too; the smelters' belt is a full Mk.1, the line's bottleneck) and a single constructor.
 */
const group = (g: Partial<LineGroup> & Pick<LineGroup, 'id' | 'cls' | 'members' | 'stage'>): LineGroup => ({
  outputs: [], inputs: [], nominal: [], productivity: 1, state: 'full', band: 'full', reasons: [], ...g,
});

export const IRON_LINE: ProductionLine = {
  id: 'plate',
  // What reaches the storage at its end (`buildLines`: flows into storage, stations, sinks plus outputs with no link).
  products: [{ item: 'Desc_IronPlate_C', perMin: 20 }],
  inputs: [],
  buildings: ['smelter', 'smelter2', 'merger', 'plate', 'plate2', 'paused', 'box'],
  machines: ['smelter', 'smelter2', 'plate', 'plate2', 'paused'],
  groups: [
    group({
      id: 'g-smelt', cls: 'Build_SmelterMk1_C', recipe: 'Recipe_IngotIron_C', members: ['smelter', 'smelter2'], stage: 0,
      outputs: [{ item: 'Desc_IronIngot_C', perMin: 37.5 }], nominal: [{ item: 'Desc_IronIngot_C', perMin: 60 }],
      productivity: 0.625, state: 'throttled', band: 'throttled', reasons: [{ reason: 'blocked', count: 1 }],
    }),
    group({ id: 'g-merge', cls: 'Build_ConveyorAttachmentMerger_C', members: ['merger'], stage: 1, logistics: true, outputs: [{ item: 'Desc_IronIngot_C', perMin: 60 }] }),
    group({
      id: 'g-plate', cls: 'Build_ConstructorMk1_C', recipe: 'Recipe_IronPlate_C', members: ['plate', 'plate2', 'paused'], stage: 2,
      outputs: [{ item: 'Desc_IronPlate_C', perMin: 20 }], inputs: [{ item: 'Desc_IronIngot_C', perMin: 30 }], nominal: [{ item: 'Desc_IronPlate_C', perMin: 40 }],
      productivity: 0.333, state: 'throttled', band: 'throttled', reasons: [{ reason: 'starved', count: 1 }, { reason: 'paused', count: 1 }],
    }),
    group({ id: 'g-box', cls: 'Build_StorageContainerMk1_C', members: ['box'], stage: 3, logistics: true }),
  ],
  edges: [
    { from: 'g-smelt', to: 'g-merge', item: 'Desc_IronIngot_C', perMin: 60, capacity: 60, slowest: 'Build_ConveyorBeltMk1_C', links: 2, via: ['belt1', 'belt2'], saturated: true },
    { from: 'g-merge', to: 'g-plate', item: 'Desc_IronIngot_C', perMin: 30, capacity: 120, slowest: 'Build_ConveyorBeltMk2_C', links: 1, via: ['belt3'] },
    { from: 'g-plate', to: 'g-box', item: 'Desc_IronPlate_C', perMin: 20, capacity: 60, slowest: 'Build_ConveyorBeltMk1_C', links: 1, via: ['belt4'] },
    { from: 'g-merge', to: 'g-box', item: 'Desc_IronIngot_C', perMin: 0, capacity: 60, slowest: 'Build_ConveyorBeltMk1_C', links: 1, via: ['belt5'] },
  ],
  productivity: 0.4,
  nominal: 40,
  actual: 20,
  bottleneck: { kind: 'edge', edge: 0, why: 'capacity' },
};

export const SMALL_LINE: ProductionLine = {
  id: 'solo',
  products: [{ item: 'Desc_IronPlate_C', perMin: 20 }],
  inputs: [{ item: 'Desc_IronIngot_C', perMin: 30 }],
  buildings: ['solo'],
  machines: ['solo'],
  groups: [
    group({
      id: 'g-solo', cls: 'Build_ConstructorMk1_C', recipe: 'Recipe_IronPlate_C', members: ['solo'], stage: 0,
      outputs: [{ item: 'Desc_IronPlate_C', perMin: 20 }], nominal: [{ item: 'Desc_IronPlate_C', perMin: 20 }],
    }),
  ],
  edges: [],
  productivity: 1,
  nominal: 20,
  actual: 20,
};

export const LINES: ProductionLines = {
  lines: [IRON_LINE, SMALL_LINE],
  index: new Map([...IRON_LINE.buildings.map(b => [b, IRON_LINE.id] as const), ['solo', SMALL_LINE.id]]),
};
