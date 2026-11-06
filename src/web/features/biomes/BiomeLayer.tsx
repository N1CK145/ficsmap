import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Marker, Polygon, useMap } from 'react-leaflet';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { prefersReducedMotion } from '../map/motion.js';
import { biomeName, labelPoints, maskRings, ringBounds, ringsOf, useBiomeHover, useBiomeShapes, type LatLngRing } from './useBiomes.js';

/** Labels show only while zoomed far out (spec §10.4). */
const LABEL_MAX_ZOOM = 2;
const FIT_PADDING: L.PointTuple = [24, 24];
const MASK_OPACITY = 0.45;

interface Colors { accent: string; fg: string; bg: string }

/** Theme colours, read once from the CSS tokens so no colour is written down here. */
function readColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim() || 'currentColor';
  return { accent: token('--color-accent'), fg: token('--color-fg'), bg: token('--color-bg') };
}

/**
 * Biomes on the map (spec §10.4): faint labels at zoom 0–2, a thin outline on the hovered biome (map
 * or sidebar), and for the scoped biome an orange outline, a mask over everything outside it, and a
 * fit of the view when the scope changes. The polygons are invisible hit areas; clicks bubble to the
 * map as usual, so marker clicks keep working. Rendered inside the map.
 */
export function BiomeLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const mobile = useIsMobile();
  const { i18n } = useTranslation();
  const shapes = useBiomeShapes(ctx.me.datasetVersion);
  const scope = useUiStore(s => s.biomeScope);
  const setScope = useUiStore(s => s.setBiomeScope);
  const hovered = useBiomeHover(s => s.hovered);
  const setHovered = useBiomeHover(s => s.setHovered);
  const colors = useMemo(readColors, []);
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);
  useEffect(() => () => setHovered(null), [setHovered]);
  // A scope remembered from an older dataset may name a biome this one does not have (the biomes changed):
  // drop it, or every marker would count as outside the scope.
  useEffect(() => {
    if (scope !== null && !ctx.index.ds.biomes[scope]) setScope(null);
  }, [scope, ctx.index, setScope]);

  const biomes = useMemo(() => shapes?.features.map(f => ({ idx: f.properties.idx, rings: ringsOf(f) })) ?? [], [shapes]);

  // Fit when the scope changes, not for a scope restored with the view (that keeps its viewport).
  const fitted = useRef(scope);
  useEffect(() => {
    if (scope === fitted.current) return;
    if (scope === null) {
      fitted.current = null;
      return;
    }
    const rings = biomes.find(b => b.idx === scope)?.rings;
    if (!rings) return;
    fitted.current = scope;
    // On mobile the lower half is under the bottom sheet the biome was picked in.
    const [px, py] = FIT_PADDING;
    map.fitBounds(ringBounds(rings), {
      paddingTopLeft: FIT_PADDING,
      paddingBottomRight: mobile ? [px, py + Math.round(map.getSize().y / 2)] : FIT_PADDING,
      animate: !prefersReducedMotion(),
    });
  }, [scope, biomes, map, mobile]);

  const scoped = scope === null ? undefined : biomes.find(b => b.idx === scope);
  return (
    <>
      {scoped && (
        <Polygon
          positions={maskRings(scoped.rings)}
          interactive={false}
          pathOptions={{ stroke: false, fill: true, fillColor: colors.bg, fillOpacity: MASK_OPACITY }}
        />
      )}
      {biomes.map(b => (
        <Polygon
          key={b.idx}
          positions={b.rings}
          pathOptions={hitOptions(b.idx === scope, b.idx === hovered, colors)}
          eventHandlers={{ mouseover: () => setHovered(b.idx), mouseout: () => setHovered(null) }}
        />
      ))}
      {zoom <= LABEL_MAX_ZOOM && biomes.map(b => <BiomeLabels key={b.idx} rings={b.rings} name={biomeName(ctx.index.ds, b.idx, i18n.language)} />)}
    </>
  );
}

/** Leaflet's own pointer cursor on these would hide the grab and mode cursors (map.css). */
export const HIT_CLASS = 'ficsmap-biome-hit';

/** Stroke only for the scoped or hovered biome; otherwise an invisible but hoverable fill. */
export function hitOptions(scoped: boolean, hover: boolean, c: Colors): L.PathOptions {
  if (scoped) return { className: HIT_CLASS, stroke: true, color: c.accent, weight: 2.5, fill: true, fillColor: c.fg, fillOpacity: 0 };
  if (hover) return { className: HIT_CLASS, stroke: true, color: c.fg, weight: 1, fill: true, fillColor: c.fg, fillOpacity: 0 };
  return { className: HIT_CLASS, stroke: false, fill: true, fillColor: c.fg, fillOpacity: 0 };
}

/** The biome's name on each of its larger parts. */
function BiomeLabels({ rings, name }: { rings: LatLngRing[]; name: string | undefined }) {
  const positions = useMemo(() => labelPoints(rings), [rings]);
  return <>{positions.map(p => <BiomeLabel key={`${p[0]},${p[1]}`} position={p} name={name} />)}</>;
}

function BiomeLabel({ position, name }: { position: [number, number]; name: string | undefined }) {
  const icon = useMemo(() => {
    const el = document.createElement('span');
    el.className = 'ficsmap-biome-label__text';
    el.textContent = name ?? '';
    return L.divIcon({ className: 'ficsmap-biome-label', html: el, iconSize: [0, 0] });
  }, [name]);
  if (!name) return null;
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} />;
}
