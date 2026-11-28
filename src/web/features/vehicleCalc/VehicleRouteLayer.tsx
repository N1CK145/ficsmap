import './vehicleRoute.css';
import L, { type LatLngTuple, type LeafletEvent } from 'leaflet';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Marker, Pane, Polyline } from 'react-leaflet';
import { latLngToWorld, worldToLatLng } from '../../../shared/geo.js';
import type { VehicleRoute, WorldPoint } from '../../../shared/vehicleRoute.js';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { PICK_MODE, useVehicleCalc, useVehicleCalcWorld } from './useVehicleCalc.js';
import { mapStyle } from '../map/mapStyle.js';

/**
 * The line's own pane: above the collectible markers' canvas (450) and the resource nodes (455), so it stays visible in
 * dense areas; below Leaflet's marker pane (600), where the A and B pins are. It takes no pointer events, so clicks
 * still reach the map and the markers under it.
 */
export const ROUTE_PANE = 'ficsmap-vehicle-route';
export const ROUTE_PANE_Z = 460;

/** The vehicles' colour (as in the machine wiki) and the background for the line's casing, read from the CSS tokens. */
function readColours(): { line: string; casing: string } {
  const style = mapStyle();
  const token = (name: string) => style.getPropertyValue(name).trim() || 'currentColor';
  return { line: token('--color-cat-vehicles'), casing: token('--color-bg') };
}

/** A round pin with a letter; 44 px around it is the touch target for dragging (vehicleRoute.css). */
function pin(letter: 'A' | 'B'): L.DivIcon {
  return L.divIcon({ className: 'ficsmap-vroute-pin', html: `<span>${letter}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] });
}

/**
 * The vehicle calculator's route on the map: the start (A) and the destination (B) with the straight line between
 * them, shown while they are set (the calculator is a page of its own), above the collectible markers (`ROUTE_PANE`).
 * A and B can be dragged; the calculator follows, and a point dropped near a resource node shown on the map snaps onto it. The route is this world's (`useVehicleCalcWorld`).
 * While points are picked (PICK_MODE) only the start picked so far is shown.
 */
export function VehicleRouteLayer({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  useVehicleCalcWorld(ctx.worldId);
  const picking = useUiStore(s => s.interactionMode === PICK_MODE);
  const route = useVehicleCalc(s => s.route);
  const pickedStart = useVehicleCalc(s => s.pickedStart);
  const colours = useMemo(readColours, []);
  const icons = useMemo(() => ({ start: pin('A'), end: pin('B') }), []);
  const bounds = ctx.index.ds.bounds;
  const at = (p: WorldPoint): LatLngTuple => worldToLatLng(p.x, p.y, bounds);
  // Stable, so react-leaflet does not rebind them on every render of a drag.
  const handlers = useMemo(() => {
    // While dragging the point follows the pointer; where it is dropped it snaps onto a resource node near it.
    const moved = (which: keyof VehicleRoute, drop: boolean) => (e: LeafletEvent) => {
      const marker = e.target as L.Marker;
      const p = marker.getLatLng();
      const s = useVehicleCalc.getState();
      const point = latLngToWorld(p.lat, p.lng, bounds);
      const at = drop ? s.snap(point) : point;
      s.moveRoutePoint(which, at);
      // The pin is where Leaflet dropped it, and React's position did not change when the route already had that point.
      if (at !== point) marker.setLatLng(worldToLatLng(at.x, at.y, bounds));
    };
    return { start: { drag: moved('start', false), dragend: moved('start', true) }, end: { drag: moved('end', false), dragend: moved('end', true) } };
  }, [bounds]);

  if (picking) {
    if (!pickedStart) return null;
    return <Marker position={at(pickedStart)} icon={icons.start} interactive={false} keyboard={false} title={t('vehicleCalc.pick.startPoint')} />;
  }
  if (!route) return null;
  return (
    <>
      <Pane name={ROUTE_PANE} style={{ zIndex: ROUTE_PANE_Z, pointerEvents: 'none' }}>
        {/* A dark casing under the line, so it reads over the coloured markers. */}
        <Polyline positions={[at(route.start), at(route.end)]} interactive={false} pathOptions={{ color: colours.casing, weight: 8, opacity: 0.75 }} />
        <Polyline positions={[at(route.start), at(route.end)]} interactive={false} pathOptions={{ color: colours.line, weight: 4, opacity: 1 }} />
      </Pane>
      <Marker position={at(route.start)} icon={icons.start} draggable keyboard={false} title={t('vehicleCalc.pick.startPoint')}
        eventHandlers={handlers.start} />
      <Marker position={at(route.end)} icon={icons.end} draggable keyboard={false} title={t('vehicleCalc.pick.endPoint')}
        eventHandlers={handlers.end} />
    </>
  );
}
