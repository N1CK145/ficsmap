import { UNITS_PER_METER } from './geo.js';

/** A point on the map in world units (cm), as items and the height map use them. */
export interface WorldPoint { x: number; y: number }

/** Start and destination of a vehicle route picked on the map. */
export interface VehicleRoute { start: WorldPoint; end: WorldPoint }

export interface RouteGeometry {
  /** Straight-line distance on the map (2D) in metres. */
  meters: number;
  /** Height of the destination minus the start in metres (positive: uphill to the destination); null without both heights. */
  climbMeters: number | null;
  /** Straight-line distance in 3D (with the height difference) in metres; null without both heights. */
  meters3d: number | null;
}

/**
 * The straight line between two map points: its length on the map and, with the heights of both ends (cm, as
 * `HeightSource.heightAt` gives them; null or undefined for unknown), the height difference and the 3D length.
 */
export function routeGeometry(start: WorldPoint, end: WorldPoint, startHeight?: number | null, endHeight?: number | null): RouteGeometry {
  const meters = Math.hypot(end.x - start.x, end.y - start.y) / UNITS_PER_METER;
  if (startHeight == null || endHeight == null) return { meters, climbMeters: null, meters3d: null };
  const climbMeters = (endHeight - startHeight) / UNITS_PER_METER;
  return { meters, climbMeters, meters3d: Math.hypot(meters, climbMeters) };
}

/** The route length input's value for a route: its straight-line length in whole metres. */
export function routeLengthInput(route: VehicleRoute): string {
  return String(Math.round(routeGeometry(route.start, route.end).meters));
}
