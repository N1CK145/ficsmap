import type { CollectibleTypeId, LocalizedName, WorldBounds } from './types.js';

export interface PodRequirement { item: LocalizedName | null; amount: number; power: number }
/** `cave`: the item lies inside a cave (dataset built with caves.json). */
export interface ItemExtra { pod?: PodRequirement; shards?: number; cave?: true }
/** What lies around a drop pod's crash site (`/data/<v>/crash-sites.json`); names and notes are English. */
export interface CrashSite {
  items: { item: string; amount: number; where?: string }[];
  /** `count` null: "some" (e.g. gas pillars). */
  threats: { name: string; count: number | null }[];
  notes: string[];
}
export type CrashSites = Record<string, CrashSite>;
export type DatasetItemTuple = [
  name: string, type: CollectibleTypeId, x: number, y: number, z: number, biomeIdx: number, seq: number, extra?: ItemExtra,
];
export interface Dataset {
  version: string;
  build: number;
  bounds: WorldBounds;
  mapId: string;
  podRequirementsKnown: boolean;
  biomes: { id: string; name: LocalizedName }[];
  items: DatasetItemTuple[];
  aliases: Record<string, string>;
}
export interface Item {
  name: string; type: CollectibleTypeId; x: number; y: number; z: number; biome: number; seq: number; extra?: ItemExtra;
}
export interface DatasetIndex {
  ds: Dataset;
  items: Item[];
  byName: Map<string, Item>;
  has(name: string): boolean;
  /** The name itself if it is an item, else its alias target, else undefined. */
  resolve(name: string): string | undefined;
}

export function indexDataset(ds: Dataset): DatasetIndex {
  const items: Item[] = ds.items.map(([name, type, x, y, z, biome, seq, extra]) => {
    const item: Item = { name, type, x, y, z, biome, seq };
    if (extra) item.extra = extra;
    return item;
  });
  const byName = new Map(items.map(i => [i.name, i]));
  return {
    ds,
    items,
    byName,
    has: name => byName.has(name),
    resolve: name => (byName.has(name) ? name : Object.hasOwn(ds.aliases, name) ? ds.aliases[name] : undefined),
  };
}
