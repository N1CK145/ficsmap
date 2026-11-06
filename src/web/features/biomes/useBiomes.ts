import { useQuery } from '@tanstack/react-query';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { Dataset } from '../../../shared/dataset.js';
import { worldToLatLng } from '../../../shared/geo.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { IMAGE_RING } from '../map/imageBounds.js';
import { useDataset } from '../map/useDataset.js';
import type { Count } from '../progress/count.js';

/** A ring of `[lat, lng]` pairs (Leaflet's order). */
export type LatLngRing = [lat: number, lng: number][];
export interface BiomeProps { idx: number; id: string; name: string }
export type BiomeShapes = FeatureCollection<Polygon, BiomeProps>;

/**
 * The biome polygons of one dataset version (`/data/<v>/biomes.geojson`, world coordinates), with
 * every ring converted by `worldToLatLng` into the map's image space. As GeoJSON requires, the pairs
 * are `[lng, lat]`; `ringsOf` returns them in Leaflet's `[lat, lng]` order. `idx` matches
 * `Item.biome` and `Dataset.biomes[idx]`. Undefined until both the shapes and the dataset are there.
 */
export function useBiomeShapes(version: string): BiomeShapes | undefined {
  const index = useDataset(version);
  const raw = useQuery({
    queryKey: queryKeys.biomes(version),
    queryFn: () => api<FeatureCollection<Polygon, BiomeProps>>('GET', `/data/${encodeURIComponent(version)}/biomes.geojson`),
    staleTime: Infinity,
  }).data;
  const bounds = index?.ds.bounds;
  return useMemo(() => (raw && bounds ? toImageSpace(raw, bounds) : undefined), [raw, bounds]);
}

function toImageSpace(raw: BiomeShapes, bounds: Dataset['bounds']): BiomeShapes {
  return {
    type: 'FeatureCollection',
    features: raw.features.map((f): Feature<Polygon, BiomeProps> => ({
      type: 'Feature',
      properties: f.properties,
      geometry: {
        type: 'Polygon',
        coordinates: f.geometry.coordinates.map(ring => ring.map(p => {
          const [lat, lng] = worldToLatLng(p[0]!, p[1]!, bounds);
          return [lng, lat];
        })),
      },
    })),
  };
}

/** A converted feature's rings as `[lat, lng]` pairs. */
export function ringsOf(f: Feature<Polygon, BiomeProps>): LatLngRing[] {
  return f.geometry.coordinates.map(ring => ring.map(p => [p[1]!, p[0]!] as [number, number]));
}

/**
 * The mask over everything outside a biome: the image rectangle plus the biome's rings. Drawn with
 * Leaflet's even-odd fill, the rings are holes.
 */
export function maskRings(biomeRings: LatLngRing[]): LatLngRing[] {
  return [IMAGE_RING, ...biomeRings];
}

function ringArea(ring: LatLngRing): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![1] * ring[i]![0] - ring[i]![1] * ring[j]![0];
  return a / 2;
}

/** Where a biome's label goes: the centroid of its largest ring (an approximation of the visual centre). */
export function labelPoint(rings: LatLngRing[]): [lat: number, lng: number] {
  let best: LatLngRing | undefined;
  for (const r of rings) if (!best || Math.abs(ringArea(r)) > Math.abs(ringArea(best))) best = r;
  if (!best || best.length === 0) return [0, 0];
  const area = ringArea(best);
  if (area === 0) return [best.reduce((s, p) => s + p[0], 0) / best.length, best.reduce((s, p) => s + p[1], 0) / best.length];
  let lat = 0;
  let lng = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const [la, lo] = best[j]!;
    const [lb, ob] = best[i]!;
    const cross = lo * lb - ob * la;
    lat += (la + lb) * cross;
    lng += (lo + ob) * cross;
  }
  return [lat / (6 * area), lng / (6 * area)];
}

/** Parts smaller than this (image units², about 0.13 km²) get no label of their own. */
const MIN_LABEL_AREA = 150;

function inRing(lat: number, lng: number, ring: LatLngRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i]!, [aj, oj] = ring[j]!;
    if (ai > lat !== aj > lat && lng < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) inside = !inside;
  }
  return inside;
}

/**
 * Where a biome's labels go: one per part (outer ring) of at least MIN_LABEL_AREA, at its centroid, and at least
 * one for the largest part, so a biome in several pieces is named on each. A ring inside an odd number of the
 * biome's other rings is a hole (even-odd fill) and gets none.
 */
export function labelPoints(rings: LatLngRing[]): [lat: number, lng: number][] {
  const largest = labelPoint(rings);
  const out: [number, number][] = [];
  const parts = rings.filter(r => r.length > 0 && Math.abs(ringArea(r)) >= MIN_LABEL_AREA);
  for (const r of parts) {
    const [lat, lng] = r[0]!;
    const depth = rings.reduce((n, o) => n + (o !== r && inRing(lat, lng, o) ? 1 : 0), 0);
    if (depth % 2 === 1) continue;
    out.push(labelPoint([r]));
  }
  if (!out.some(p => p[0] === largest[0] && p[1] === largest[1])) out.unshift(largest);
  return out;
}

/** `[[south, west], [north, east]]` around all rings. */
export function ringBounds(rings: LatLngRing[]): [[number, number], [number, number]] {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      south = Math.min(south, lat); north = Math.max(north, lat);
      west = Math.min(west, lng); east = Math.max(east, lng);
    }
  }
  return [[south, west], [north, east]];
}

export interface BiomeRow { idx: number; name: string; count: Count }

/** Most items left first (`total - done`), then by name. Returns a new array. */
export function sortBiomeRows<R extends BiomeRow>(rows: readonly R[]): R[] {
  return [...rows].sort((a, b) => (b.count.total - b.count.done) - (a.count.total - a.count.done) || a.name.localeCompare(b.name));
}

export function biomeName(ds: Dataset, idx: number, language: string): string | undefined {
  return ds.biomes[idx]?.name[language === 'de' ? 'de' : 'en'];
}

/** The biome under the mouse on the map or in the sidebar (spec §10.4); shared between both. */
export const useBiomeHover = create<{ hovered: number | null; setHovered(idx: number | null): void }>()(set => ({
  hovered: null,
  setHovered: idx => set({ hovered: idx }),
}));
