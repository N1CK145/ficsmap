import type { BuildingCategory } from '../../../../shared/buildings.js';
import { bandOf, type Band } from '../../../../shared/factory/analysis.js';
import type { SnapshotProduction } from '../../../../shared/factory/snapshot.js';

/**
 * How the factory map colours things. The dataset's building categories fold into a few map kinds: three hues for the
 * machines (production, extraction, power), two neutrals for everything else, and the floor plan's own muted tone.
 */
export const MAP_KINDS = ['production', 'extraction', 'power', 'building', 'logistics', 'structure'] as const;
export type MapKind = (typeof MAP_KINDS)[number];

const KIND_OF: Record<BuildingCategory, MapKind> = {
  production: 'production',
  extraction: 'extraction',
  'power-gen': 'power',
  'power-storage': 'power',
  'power-pole': 'logistics',
  'logistics-belt': 'logistics',
  'logistics-pipe': 'logistics',
  hypertube: 'logistics',
  storage: 'building',
  transport: 'building',
  special: 'building',
  other: 'building',
  sign: 'logistics',
  structure: 'structure',
};

export function mapKind(category: BuildingCategory | undefined): MapKind {
  return category ? KIND_OF[category] : 'building';
}

/** The CSS colour token (without `--color-`) of a map kind. */
export const KIND_TOKEN: Record<MapKind, string> = {
  production: 'fac-production',
  extraction: 'fac-extraction',
  power: 'fac-power',
  building: 'fac-building',
  logistics: 'fac-minor',
  structure: 'fac-floor',
};

/** The productivity a machine counts with: as measured, else 100 % when it was producing at saving time, else 0 (as the page does). */
export function productivityOf(prod: SnapshotProduction): number {
  return Math.min(1, Math.max(0, prod.productivity ?? (prod.producing ? 1 : 0)));
}

/** A machine's band (the factory page's: standing, throttled, nearly full, full); null for buildings without production. */
export function machineBand(prod: SnapshotProduction | undefined): Band | null {
  return prod ? bandOf(productivityOf(prod)) : null;
}

/** The fill token per band, the same colours as the factory page's `BAND_FILL`. */
export const BAND_TOKEN: Record<Band, string> = {
  idle: 'conflict',
  throttled: 'accent',
  high: 'power',
  full: 'free',
};

/** Bands below 90 % (standing, throttled) also get a hatch on the map, so colour is never the only cue. */
export const HATCHED: ReadonlySet<Band> = new Set<Band>(['idle', 'throttled']);

/** Belts, pipes, hypertubes, roads and rails as the map draws them. */
export type LineKind = 'belt' | 'pipe' | 'hyper' | 'road' | 'rail';

export interface LineStyle {
  kind: LineKind;
  /** Mk level: belts 1–6, pipes 1–2; 1 for the rest. */
  tier: number;
}

/** The kind and tier of a spline class, or null for classes the map does not know. */
export function lineStyle(cls: string): LineStyle | null {
  const belt = /^Build_ConveyorBeltMk(\d)_C$/i.exec(cls);
  if (belt) return { kind: 'belt', tier: Number(belt[1]) };
  if (/^Build_Pipeline(MK2)?(_NoIndicator)?_C$/i.test(cls)) return { kind: 'pipe', tier: /MK2/i.test(cls) ? 2 : 1 };
  if (/^Build_PipeHyper/i.test(cls)) return { kind: 'hyper', tier: 1 };
  if (/^Build_VehiclePath/i.test(cls)) return { kind: 'road', tier: 1 };
  if (/^Build_RailroadTrack/i.test(cls)) return { kind: 'rail', tier: 1 };
  return null;
}

/** Line width in CSS px at the zoom where lines first show; wider for higher tiers. */
export function lineWidthPx(s: LineStyle): number {
  switch (s.kind) {
    case 'belt': return 0.8 + 0.3 * (s.tier - 1);
    case 'pipe': return s.tier === 2 ? 2 : 1.4;
    case 'hyper': return 1.6;
    case 'road': return 3;
    case 'rail': return 2.5;
  }
}

/** Belt opacity: Mk.1 faint, Mk.6 full, so the main lines read first. */
export function lineAlpha(s: LineStyle): number {
  return s.kind === 'belt' ? 0.45 + 0.11 * (s.tier - 1) : 0.85;
}

/** The token of a line kind. */
export const LINE_TOKEN: Record<LineKind, string> = {
  belt: 'fac-belt',
  pipe: 'fac-pipe',
  hyper: 'muted',
  road: 'fac-road',
  rail: 'fac-road',
};
