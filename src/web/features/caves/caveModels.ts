import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { caveModelIndexUrl, type CaveModelEntry, type CaveModelIndex } from '../../../shared/caveModels.js';
import type { DatasetIndex, Item } from '../../../shared/dataset.js';
import { pointInRings, worldToLatLng } from '../../../shared/geo.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { caveNumber, type CaveEntrancePoint, type CaveShapes } from './useCaves.js';

export { caveNumber };

/** The number the map shows for a cave (`n` in caves.geojson; while the caves load, the number in its id). */
export function caveLabelNumber(id: string, shapes: CaveShapes | null | undefined): number {
  const k = shapes ? shapes.ids.indexOf(id) : -1;
  return k >= 0 ? shapes!.numbers[k]! : caveNumber(id);
}

/** The id of the 3D model a cave is shown with (several caves can share one: they lie in one geometry cave). */
export function caveModelId(id: string, shapes: CaveShapes | null | undefined): string {
  const k = shapes ? shapes.ids.indexOf(id) : -1;
  return k >= 0 ? shapes!.models[k]! : id;
}

/** The id of the cave whose outline holds this map point, or null. */
export function caveAt(lat: number, lng: number, shapes: CaveShapes): string | null {
  for (let k = 0; k < shapes.caves.length; k++) {
    if (pointInRings(lat, lng, shapes.caves[k]!)) return shapes.ids[k] ?? null;
  }
  return null;
}

/**
 * The 3D models of a dataset version (`cave-models/index.json`) by cave id: `null` for a dataset built without them,
 * undefined while loading or while not `enabled`.
 */
export function useCaveModels(version: string, enabled = true): ReadonlyMap<string, CaveModelEntry> | null | undefined {
  return useQuery({
    queryKey: queryKeys.caveModels(version),
    enabled,
    queryFn: async () => {
      try {
        const index = await api<CaveModelIndex>('GET', caveModelIndexUrl(version));
        return new Map(index.caves.map(c => [c.id, c]));
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  }).data;
}

interface CaveViewerState {
  /** The cave box on the map: the cave and where it was clicked (map coordinates). */
  popup: { id: string; lat: number; lng: number } | null;
  /** The cave shown in the 3D viewer. */
  viewing: string | null;
  openPopup(id: string, lat: number, lng: number): void;
  closePopup(): void;
  view(id: string): void;
  closeViewer(): void;
}

export const useCaveViewer = create<CaveViewerState>()(set => ({
  popup: null,
  viewing: null,
  openPopup: (id, lat, lng) => set({ popup: { id, lat, lng } }),
  closePopup: () => set({ popup: null }),
  view: id => set({ viewing: id, popup: null }),
  closeViewer: () => set({ viewing: null }),
}));

/** What a cave holds: the tracked collectibles inside its outline and its entrances. */
export function caveContents(id: string, shapes: CaveShapes, index: DatasetIndex): { items: Item[]; entrances: CaveEntrancePoint[] } {
  const k = shapes.ids.indexOf(id);
  const rings = k < 0 ? undefined : shapes.caves[k];
  const items = rings
    ? index.items.filter(i => i.extra?.cave === true && pointInRings(...worldToLatLng(i.x, i.y, index.ds.bounds), rings))
    : [];
  return { items, entrances: shapes.entrances.filter(e => e.cave === id) };
}

/** A point to mark in the 3D view: world position (UE cm) and a CSS colour. */
export interface ViewerMarker { x: number; y: number; z: number; color: string; kind: 'entrance' | 'item' }

/** UE world cm (Z up) to the models' glTF metres (Y up): (X, Z, Y) / 100. */
export function ueToModel(x: number, y: number, z: number): [number, number, number] {
  return [x / 100, z / 100, y / 100];
}

/** The height (model metres) above which the cut removes everything: `cut` 1 keeps the whole model. */
export function cutHeight(cut: number, minY: number, maxY: number): number {
  const c = Math.min(1, Math.max(0, cut));
  return c >= 1 ? maxY + 1 : minY + c * (maxY - minY);
}
