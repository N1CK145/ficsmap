import type { CollectibleTypeId } from './types.js';

export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle';

export interface CollectibleType {
  id: CollectibleTypeId;
  labelKey: string;
  shape: MarkerShape;
  colorToken: string;
  pips: 0 | 1 | 2 | 3;
  glyph: 'none' | 'swirl' | 'ring' | 'disk';
  source: 'pickups' | 'dropPods';
  classes: readonly string[];
  details: 'none' | 'powerSlug' | 'dropPod';
  /** Key of the game icon in the dataset (`/data/<v>/icons/<icon>.png`); the shape is the fallback. */
  icon: string;
  powerShards?: number;
}

/** Order = sidebar order (spec §10.1 table order). Class names and shard yields: data-src/extractor/README.md. */
export const COLLECTIBLE_TYPES: readonly CollectibleType[] = [
  { id: 'slug_blue', labelKey: 'types.slug_blue', shape: 'circle', colorToken: 'slug-blue', pips: 1, glyph: 'none',
    source: 'pickups', classes: ['BP_Crystal_C'], details: 'powerSlug', icon: 'Desc_Crystal_C', powerShards: 1 },
  { id: 'slug_yellow', labelKey: 'types.slug_yellow', shape: 'circle', colorToken: 'slug-yellow', pips: 2, glyph: 'none',
    source: 'pickups', classes: ['BP_Crystal_mk2_C'], details: 'powerSlug', icon: 'Desc_Crystal_mk2_C', powerShards: 2 },
  { id: 'slug_purple', labelKey: 'types.slug_purple', shape: 'circle', colorToken: 'slug-purple', pips: 3, glyph: 'none',
    source: 'pickups', classes: ['BP_Crystal_mk3_C'], details: 'powerSlug', icon: 'Desc_Crystal_mk3_C', powerShards: 5 },
  { id: 'somersloop', labelKey: 'types.somersloop', shape: 'square', colorToken: 'sloop', pips: 0, glyph: 'swirl',
    source: 'pickups', classes: ['BP_WAT1_C'], details: 'none', icon: 'Desc_WAT1_C' },
  { id: 'mercer_sphere', labelKey: 'types.mercer_sphere', shape: 'diamond', colorToken: 'mercer', pips: 0, glyph: 'ring',
    source: 'pickups', classes: ['BP_WAT2_C'], details: 'none', icon: 'Desc_WAT2_C' },
  { id: 'hard_drive', labelKey: 'types.hard_drive', shape: 'triangle', colorToken: 'hdd', pips: 0, glyph: 'disk',
    source: 'dropPods', classes: ['BP_DropPod_C'], details: 'dropPod', icon: 'hardDrive' },
];

export function typeById(id: CollectibleTypeId): CollectibleType {
  const t = COLLECTIBLE_TYPES.find(x => x.id === id);
  if (!t) throw new Error(`Unknown collectible type: ${id}`);
  return t;
}

export function classify(source: 'pickups' | 'dropPods', cls: string): CollectibleTypeId | null {
  return COLLECTIBLE_TYPES.find(t => t.source === source && t.classes.includes(cls))?.id ?? null;
}
