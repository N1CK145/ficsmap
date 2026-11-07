import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { DatasetIndex } from '../../../shared/dataset.js';
import type { WorldBounds } from '../../../shared/types.js';
import { worldToLatLng } from '../../../shared/geo.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

interface CaveFeature {
  type: 'Feature';
  properties: { kind: 'cave'; id: string } | { kind: 'entrance'; cave: string; z: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'Point'; coordinates: number[] };
}
interface CaveGeojson { type: 'FeatureCollection'; features: CaveFeature[] }

export type LatLngRing = [lat: number, lng: number][];
/** An entrance in world coordinates (cm) and in map coordinates. */
export interface CaveEntrancePoint { x: number; y: number; z: number; lat: number; lng: number }
/** Per cave its outline rings as Leaflet rings (`[lat, lng]`, filled even-odd) and its id (same order), and all entrances. */
export interface CaveShapes { caves: LatLngRing[][]; ids: string[]; entrances: CaveEntrancePoint[] }

/**
 * The caves of a dataset version (`/data/<v>/caves.geojson`, world coordinates), converted into the
 * map's image space. `null` for a dataset built without caves; undefined while loading or while not
 * `enabled` (the file is about 1 MB, so it is only fetched once something shows caves).
 */
export function useCaves(version: string, bounds: WorldBounds, enabled = true): CaveShapes | null | undefined {
  const raw = useQuery({
    queryKey: queryKeys.caves(version),
    enabled,
    queryFn: async () => {
      try {
        return await api<CaveGeojson>('GET', `/data/${encodeURIComponent(version)}/caves.geojson`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  }).data;
  return useMemo(() => (raw === undefined ? undefined : raw === null ? null : toShapes(raw, bounds)), [raw, bounds]);
}

export function toShapes(raw: CaveGeojson, bounds: WorldBounds): CaveShapes {
  const caves: LatLngRing[][] = [];
  const ids: string[] = [];
  const entrances: CaveEntrancePoint[] = [];
  for (const f of raw.features) {
    if (f.properties.kind === 'cave' && f.geometry.type === 'Polygon') {
      caves.push(f.geometry.coordinates.map(ring => ring.map(p => worldToLatLng(p[0]!, p[1]!, bounds))));
      ids.push(f.properties.id);
    } else if (f.properties.kind === 'entrance' && f.geometry.type === 'Point') {
      const [x, y] = f.geometry.coordinates as [number, number];
      const [lat, lng] = worldToLatLng(x, y, bounds);
      entrances.push({ x, y, z: f.properties.z, lat, lng });
    }
  }
  return { caves, ids, entrances };
}

/** Whether the dataset was built with caves: then items inside caves carry `extra.cave`. */
export function hasCaves(index: DatasetIndex): boolean {
  return index.items.some(i => i.extra?.cave === true);
}

/** 2D distance from a world point to the nearest entrance, or null without entrances. */
export function nearestEntrance(x: number, y: number, entrances: readonly CaveEntrancePoint[]): number | null {
  let best: number | null = null;
  for (const e of entrances) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (best === null || d < best) best = d;
  }
  return best;
}

const STORAGE_KEY = 'ficsmap:caves';

function readVisible(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the cave layer is shown; remembered per device (best effort, like the map view). */
export const useCaveLayer = create<{ visible: boolean; toggle(): void }>()(set => ({
  visible: readVisible(),
  toggle: () => set(s => {
    const visible = !s.visible;
    try {
      localStorage.setItem(STORAGE_KEY, visible ? '1' : '0');
    } catch {
      // Not remembering is fine.
    }
    return { visible };
  }),
}));
