import {
  countOf, filledSlots, packStacks, storageFigures, storageTotals, summarize, usedSlots,
} from '../../src/shared/factory/inventory.js';
import type { SnapshotBuilding, SnapshotInventory } from '../../src/shared/factory/snapshot.js';

const INV: SnapshotInventory = { slots: 8, items: [['Desc_SteelPlate_C', 200, 3], ['Desc_Wire_C', 74], ['Desc_SteelPlate_C', 3]] };

describe('inventory runs', () => {
  it('packs equal neighbouring slots into one run and skips empty slots', () => {
    expect(packStacks([
      { item: 'A', count: 100 }, { item: 'A', count: 100 }, { count: 0 }, { item: 'A', count: 100 }, { item: 'A', count: 7 }, { item: 'B', count: 0 }, { item: 'B', count: 3 },
    ])).toEqual([['A', 100, 3], ['A', 7], ['B', 3]]);
    expect(packStacks([])).toEqual([]);
  });

  it('expands runs back into slots, counts the used ones and what an item adds up to', () => {
    expect(filledSlots(INV)).toEqual([
      { item: 'Desc_SteelPlate_C', count: 200 }, { item: 'Desc_SteelPlate_C', count: 200 }, { item: 'Desc_SteelPlate_C', count: 200 },
      { item: 'Desc_Wire_C', count: 74 }, { item: 'Desc_SteelPlate_C', count: 3 },
    ]);
    expect(usedSlots(INV)).toBe(5);
    expect(countOf(INV, 'Desc_SteelPlate_C')).toBe(603);
    expect(countOf(undefined, 'Desc_Wire_C')).toBe(0);
    // never more slots than the inventory has
    expect(filledSlots({ slots: 2, items: [['A', 1, 5]] })).toHaveLength(2);
    expect(usedSlots({ slots: 2, items: [['A', 1, 5]] })).toBe(2);
  });

  it('sums per item with its stacks, most first', () => {
    expect(summarize(INV)).toEqual([
      { item: 'Desc_SteelPlate_C', total: 603, stacks: 4 },
      { item: 'Desc_Wire_C', total: 74, stacks: 1 },
    ]);
  });
});

describe('storage across the factory', () => {
  const b = (id: string, inv?: SnapshotInventory, extra: Partial<SnapshotBuilding> = {}): SnapshotBuilding => ({ id, cls: 'Build_StorageContainerMk1_C', x: 0, y: 0, z: 0, yaw: 0, ...(inv ? { inv } : {}), ...extra });
  const buildings = [
    b('s1', INV),
    b('s2', { slots: 24, items: [['Desc_Wire_C', 500, 2]] }),
    b('s3', { slots: 24, items: [] }),
    // a machine's slots are no storage
    b('m1', undefined, { cls: 'Build_ConstructorMk1_C', prod: { clock: 1 }, in: { slots: 1, items: [['Desc_Wire_C', 99]] } }),
  ];

  it('totals per item with the storages holding it, most first', () => {
    expect(storageTotals({ buildings })).toEqual([
      { item: 'Desc_Wire_C', total: 1074, stacks: 3, holders: [{ id: 's2', count: 1000 }, { id: 's1', count: 74 }] },
      { item: 'Desc_SteelPlate_C', total: 603, stacks: 4, holders: [{ id: 's1', count: 603 }] },
    ]);
  });

  it('counts storages and their slots, empty ones too', () => {
    expect(storageFigures({ buildings })).toEqual({ buildings: 3, slots: 56, used: 7 });
  });
});
