/**
 * 3D models of single caves: the dataset part `cave-models` (scripts/cave-models.ts) writes one small GLB per cave
 * into `cave-models/`, plus `cave-models/index.json`. The cave viewer in the app reads both.
 */

/** The folder of the models inside a dataset version. */
export const CAVE_MODELS_DIR = 'cave-models';

/** Node (and mesh) names inside a model: the rocks and meshes of the cave, and the landscape around it. */
export const CAVE_MODEL_ROCK = 'rock';
export const CAVE_MODEL_LANDSCAPE = 'landscape';

export interface CaveModelEntry {
  /** The cave id of `caves.geojson` (`cave-012`). */
  id: string;
  /** File name inside `cave-models/`. */
  file: string;
  /** Short content hash: part of the URL, so the file may be cached forever. */
  hash: string;
  /** Triangles after simplification (rock + landscape). */
  triangles: number;
  bytes: number;
}

/** `cave-models/index.json`. */
export interface CaveModelIndex {
  /** Largest deviation from the game's geometry the simplification allowed, in metres. */
  maxError: number;
  caves: CaveModelEntry[];
}

/** The URL of a cave's model; the hash in the query keeps a rebuilt model from being served from cache. */
export function caveModelUrl(version: string, entry: CaveModelEntry): string {
  return `/data/${encodeURIComponent(version)}/${CAVE_MODELS_DIR}/${encodeURIComponent(entry.file)}?v=${encodeURIComponent(entry.hash)}`;
}

/** The URL of the index of a dataset version. */
export function caveModelIndexUrl(version: string): string {
  return `/data/${encodeURIComponent(version)}/${CAVE_MODELS_DIR}/index.json`;
}
