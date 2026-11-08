import { LITRES_PER_M3 } from '../transport.js';
import type { FactorySnapshot, SnapshotBuilding, SnapshotInventory, SnapshotStack } from './snapshot.js';

/*
 * Inventories of a factory snapshot (`SnapshotInventory`): packing slots into runs when extracting, and reading them
 * back for the views (slot grid, per item summary, what lies in storage across the factory). Pure.
 */

/** Inventories store fluids in litres; the game shows m³. */
export { LITRES_PER_M3 };

/**
 * Capacity of the fluid buffers in m³ (not in the save). The game fills them a little over it (403 m³ in a full Fluid
 * Buffer), so views cap the shown amount here.
 */
export const FLUID_BUFFER_M3: Readonly<Record<string, number>> = { Build_PipeStorageTank_C: 400, Build_IndustrialTank_C: 2400 };

/** Length caps the server's snapshot schema enforces: runs per inventory, slots per inventory, Dimensional Depot items. */
export const MAX_RUNS = 1000;
export const MAX_SLOTS = 10_000;
export const MAX_DEPOT_ITEMS = 2000;

/**
 * The filled slots of an inventory in slot order as runs: consecutive slots with the same item and count become one
 * `[item, count, times]` (`times` left out when 1). Empty slots (no item or count 0) are skipped.
 */
export function packStacks(slots: readonly { item?: string; count: number }[]): SnapshotStack[] {
  const out: SnapshotStack[] = [];
  for (const s of slots) {
    if (!s.item || s.count <= 0) continue;
    const last = out[out.length - 1];
    if (last && last[0] === s.item && last[1] === s.count) last[2] = (last[2] ?? 1) + 1;
    else out.push([s.item, s.count]);
    if (out.length >= MAX_RUNS) break;
  }
  return out;
}

/** One filled slot. */
export interface FilledSlot { item: string; count: number }

/** The filled slots one by one, in slot order (runs expanded; never more than `slots`). */
export function filledSlots(inv: SnapshotInventory): FilledSlot[] {
  const out: FilledSlot[] = [];
  for (const [item, count, times = 1] of inv.items) {
    for (let i = 0; i < times && out.length < Math.max(inv.slots, 0); i++) out.push({ item, count });
  }
  return out;
}

/** How many slots hold something. */
export function usedSlots(inv: SnapshotInventory): number {
  return Math.min(inv.slots, inv.items.reduce((n, [, , times = 1]) => n + times, 0));
}

/** How much of `item` an inventory holds (0 without the inventory). */
export function countOf(inv: SnapshotInventory | undefined, item: string): number {
  if (!inv) return 0;
  return inv.items.reduce((n, [i, count, times = 1]) => n + (i === item ? count * times : 0), 0);
}

/** One item of an inventory: how much in all and in how many slots ("stacks"). */
export interface InventoryLine { item: string; total: number; stacks: number }

/** Per item what an inventory holds, most first (then by class, so the order is stable). */
export function summarize(inv: SnapshotInventory): InventoryLine[] {
  const per = new Map<string, InventoryLine>();
  for (const [item, count, times = 1] of inv.items) {
    const line = per.get(item) ?? { item, total: 0, stacks: 0 };
    line.total += count * times;
    line.stacks += times;
    per.set(item, line);
  }
  return [...per.values()].sort((a, b) => b.total - a.total || a.item.localeCompare(b.item));
}

/** A building that stores things (it has a storage inventory, also an empty one). */
export function isStorage(b: Pick<SnapshotBuilding, 'inv'>): boolean {
  return b.inv !== undefined;
}

/** One item in storage across the factory: how much, in how many slots, and the buildings holding it (most first). */
export interface StoredItem {
  item: string;
  total: number;
  stacks: number;
  holders: { id: string; count: number }[];
}

/**
 * What lies in the factory's storage (every building with a storage inventory: containers, storage boxes, Dimensional
 * Depot uploaders, fluid buffers), per item, most first. Machines, stations, vehicles, crates and the Dimensional Depot
 * itself are not storage here.
 */
export function storageTotals(snapshot: Pick<FactorySnapshot, 'buildings'>): StoredItem[] {
  const per = new Map<string, StoredItem>();
  for (const b of snapshot.buildings) {
    if (!b.inv) continue;
    for (const line of summarize(b.inv)) {
      const s = per.get(line.item) ?? { item: line.item, total: 0, stacks: 0, holders: [] };
      s.total += line.total;
      s.stacks += line.stacks;
      s.holders.push({ id: b.id, count: line.total });
      per.set(line.item, s);
    }
  }
  for (const s of per.values()) s.holders.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return [...per.values()].sort((a, b) => b.total - a.total || a.item.localeCompare(b.item));
}

/** The storage buildings and how many there are (with slots in all and slots used). */
export function storageFigures(snapshot: Pick<FactorySnapshot, 'buildings'>): { buildings: number; slots: number; used: number } {
  let buildings = 0, slots = 0, used = 0;
  for (const b of snapshot.buildings) {
    if (!b.inv) continue;
    buildings++;
    slots += b.inv.slots;
    used += usedSlots(b.inv);
  }
  return { buildings, slots, used };
}
