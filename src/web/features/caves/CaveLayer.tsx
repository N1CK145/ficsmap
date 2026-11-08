import { useMemo } from 'react';
import { CircleMarker, Pane, Polygon } from 'react-leaflet';
import type { WorldCtx } from '../../app/feature.js';
import { useCaveLayer, useCaves } from './useCaves.js';

/** Above the tiles (200), below the biome outlines (overlay pane, 400) and the marker canvas (450). */
const AREA_PANE_Z = 350;
const ENTRANCE_PANE_Z = 420;
/** The whole area pane is see-through, so the outline and fill read as one flat cave shape. */
const AREA_OPACITY = 0.35;
const ENTRANCE_RADIUS = 5;

function readColors() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim() || 'currentColor';
  return { cave: token('--color-cave'), bg: token('--color-bg') };
}

/**
 * Caves on the map, while the layer is switched on: the caves' floor plans (sampled from the game's 3D
 * geometry) as translucent shapes and the entrances as dark dots ringed in the cave colour. Not
 * interactive; clicks go to the map and markers.
 */
export function CaveLayer({ ctx }: { ctx: WorldCtx }) {
  const visible = useCaveLayer(s => s.visible);
  const caves = useCaves(ctx.me.datasetVersion, ctx.index.ds.bounds, visible);
  const colors = useMemo(readColors, []);
  if (!visible || !caves) return null;
  // Fill and outline share one colour at full opacity; the pane's opacity makes the union translucent.
  // One multi-polygon, a polygon per cave; within a cave the even-odd rule makes inner rings holes.
  const area = {
    stroke: true, color: colors.cave, weight: 1, fill: true, fillColor: colors.cave, fillOpacity: 1, fillRule: 'evenodd' as const, interactive: false,
  };
  return (
    <>
      <Pane name="ficsmap-caves" style={{ zIndex: AREA_PANE_Z, opacity: AREA_OPACITY, pointerEvents: 'none' }}>
        <Polygon positions={caves.caves} pathOptions={area} />
      </Pane>
      <Pane name="ficsmap-cave-entrances" style={{ zIndex: ENTRANCE_PANE_Z, pointerEvents: 'none' }}>
        {caves.entrances.map(e => (
          <CircleMarker
            key={`${e.x},${e.y}`}
            center={[e.lat, e.lng]}
            radius={ENTRANCE_RADIUS}
            pathOptions={{ color: colors.cave, weight: 2, fillColor: colors.bg, fillOpacity: 1, interactive: false }}
          />
        ))}
      </Pane>
    </>
  );
}
