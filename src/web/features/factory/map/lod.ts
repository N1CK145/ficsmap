import { UNITS_PER_METER } from '../../../../shared/geo.js';
import type { WorldBounds } from '../../../../shared/types.js';

/**
 * Levels of detail of the factory map, by zoom. The map works in "map units" (the 256-unit zoom-0 image of CRS.Simple);
 * one map unit is 2^zoom CSS px. In 1.2 one map unit is about 29 m, so a Constructor (8 × 10 m) is 0.5 px wide at zoom
 * 0, 4.4 px at 5, 35 px at 8 and 140 px at 10.
 */

/** Metres per map unit along x for the dataset's world bounds. */
export function metresPerMapUnit(b: WorldBounds): number {
  return (b.maxX - b.minX) / 256 / UNITS_PER_METER;
}

/** CSS px per map unit at a zoom. */
export function pxPerMapUnit(zoom: number): number {
  return 2 ** zoom;
}

export interface Detail {
  /** Machines as fixed-size dots (their outlines would be under a pixel), the floor plan as areas. */
  dots: boolean;
  /** Outlines of buildings and floor pieces. */
  outlines: boolean;
  /** Belts, pipes and hypertubes. */
  lines: boolean;
  /** Power lines (when that layer is on). */
  power: boolean;
  /** The lighter soft boxes of machines (chimneys, pipes on the roof). */
  softBoxes: boolean;
  /** Station labels with their items per minute. */
  stationLabels: boolean;
  /** Vehicle names. */
  vehicleLabels: boolean;
  /** Marker names. */
  markerLabels: boolean;
  /** Station plates carry the station's number (as the Fabrik page names it). */
  stationNumbers: boolean;
  /**
   * The close-up: hatching faint, the status in a 3 px border in the band colour and the glyph, stacked floors drawn
   * apart (the lower ones inset and dimmed, only the top one named).
   */
  closeUp: boolean;
}

export const DOTS_BELOW = 4;
export const OUTLINES_FROM = 5;
export const LINES_FROM = 4;
export const POWER_FROM = 5;
export const SOFT_FROM = 8;
export const STATION_LABELS_FROM = 6;
export const VEHICLE_LABELS_FROM = 6;
export const MARKER_LABELS_FROM = 3;
export const STATION_NUMBERS_FROM = 7;
export const CLOSE_FROM = 8;

export function detailAt(zoom: number): Detail {
  return {
    dots: zoom < DOTS_BELOW,
    outlines: zoom >= OUTLINES_FROM,
    lines: zoom >= LINES_FROM,
    power: zoom >= POWER_FROM,
    softBoxes: zoom >= SOFT_FROM,
    stationLabels: zoom >= STATION_LABELS_FROM,
    vehicleLabels: zoom >= VEHICLE_LABELS_FROM,
    markerLabels: zoom >= MARKER_LABELS_FROM,
    stationNumbers: zoom >= STATION_NUMBERS_FROM,
    closeUp: zoom >= CLOSE_FROM,
  };
}

/** A building's picture shows once its shorter side is this many CSS px (the game picture only at `labelled`). */
export const PICTURE_MIN_PX = 24;
/** Its name shows once its shorter side is this many CSS px (the picture then moves up). */
export const LABEL_MIN_PX = 64;
/** Reason glyphs show (in the productivity mode) on buildings at least this large; smaller ones keep colour and pattern. */
export const GLYPH_MIN_PX = 18;
/** From this zoom a machine's tile carries the picture of the item it makes in a corner. */
export const PRODUCT_PIN_ZOOM = 8;

export type BuildingLook = 'dot' | 'box' | 'picture' | 'labelled';

/** How one building is drawn at a zoom, from its shorter side in map units. */
export function buildingLook(zoom: number, minSideMapUnits: number): BuildingLook {
  if (zoom < DOTS_BELOW) return 'dot';
  const px = minSideMapUnits * pxPerMapUnit(zoom);
  if (px >= LABEL_MIN_PX) return 'labelled';
  return px >= PICTURE_MIN_PX ? 'picture' : 'box';
}

/** Line width in CSS px for a line `basePx` wide where lines first show: grows with the zoom from 7 on. */
export function scaledLineWidth(basePx: number, zoom: number): number {
  return basePx * Math.max(1, 2 ** ((zoom - 7) * 0.75));
}
