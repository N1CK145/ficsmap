import type { BuildingEntry } from '../../../../shared/buildings.js';
import type { Scene } from './scene.js';

export type Lang = 'en' | 'de';

export function langOf(language: string): Lang {
  return language.startsWith('de') ? 'de' : 'en';
}

/** A buildable's name in the language, or its class name when the dataset does not know it. */
export function buildingName(entry: BuildingEntry | undefined, cls: string, lang: Lang): string {
  return entry?.name[lang] ?? cls;
}

/**
 * A station's name: the player's, else the building's name with its number among the stations of that kind in the
 * save ("Truck Station 3"), so stations with the game's default name stay apart.
 */
export function stationName(scene: Scene, id: string, lang: Lang): string {
  const st = scene.stationById.get(id);
  if (!st) return id;
  if (st.s.name) return st.s.name;
  const entry = scene.byId.get(id)?.entry;
  return `${buildingName(entry, st.s.cls, lang)} ${stationNumber(scene, id)}`;
}

/**
 * A station's number among the stations of its kind in the save, from 1 (the Fabrik page's `stationNames` counts the
 * same way, so "Nr. 4" on the map's plate is "Lkw-Station 4" there); null for an unknown id.
 */
export function stationNumber(scene: Scene, id: string): number | null {
  const st = scene.stationById.get(id);
  if (!st) return null;
  return scene.stations.filter(s => s.s.cls === st.s.cls).indexOf(st) + 1;
}

/** A vehicle's name: the player's, else its kind with its number among vehicles of that kind ("Tractor 2"). */
export function vehicleName(scene: Scene, id: string, lang: Lang): string {
  const v = scene.vehicleById.get(id);
  if (!v) return id;
  if (v.v.name) return v.v.name;
  const same = scene.vehicles.filter(x => x.v.cls === v.v.cls);
  return `${buildingName(v.entry, v.v.cls, lang)} ${same.indexOf(v) + 1}`;
}
