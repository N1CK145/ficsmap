import { useEffect, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import { latLngToWorld } from '../../../shared/geo.js';
import { filterNodes } from '../../../shared/resourceNodes.js';
import type { WorldCtx } from '../../app/feature.js';
import { useNodeFilter, useNodeLayer, useWorldNodes } from '../resourceNodes/useResourceNodes.js';
import { useVehicleCalc } from './useVehicleCalc.js';

/** How close (screen pixels at the current zoom) a route point must be to a resource node to snap onto it. */
export const SNAP_PX = 20;

/**
 * Tells the vehicle calculator where its route points snap to (`useVehicleCalc.setSnap`): the resource nodes the
 * node layer shows right now (switched on, with its filters), within `SNAP_PX` at the map's zoom. Renders nothing; the
 * node data are the node layer's (loaded only while it is on).
 */
export function RouteSnap({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const visible = useNodeLayer(s => s.visible);
  const data = useWorldNodes(ctx.me.datasetVersion, ctx.worldId, visible);
  const filter = useNodeFilter(data?.extractors);
  const shown = useMemo(() => (data && visible ? filterNodes(data.nodes, filter) : []), [data, visible, filter]);
  const bounds = ctx.index.ds.bounds;

  useEffect(() => {
    const targets = shown.map(n => ({ x: n.x, y: n.y }));
    const update = () => {
      const a = map.containerPointToLatLng([0, 0]), b = map.containerPointToLatLng([SNAP_PX, 0]);
      const wa = latLngToWorld(a.lat, a.lng, bounds), wb = latLngToWorld(b.lat, b.lng, bounds);
      useVehicleCalc.getState().setSnap(targets, Math.hypot(wb.x - wa.x, wb.y - wa.y));
    };
    update();
    map.on('zoomend', update);
    return () => {
      map.off('zoomend', update);
      useVehicleCalc.getState().setSnap([], 0);
    };
  }, [map, shown, bounds]);
  return null;
}
