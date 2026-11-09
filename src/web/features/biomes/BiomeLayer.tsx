import type L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { prefersReducedMotion } from '../map/motion.js';
import { ringBounds, ringsOf, useBiomeShapes } from './useBiomes.js';

const FIT_PADDING: L.PointTuple = [24, 24];

/**
 * Biomes on the map draw nothing (the user's choice, 2026-11-08: no outlines, labels or scope mask on the map; the
 * sidebar's biome panel stays). The layer only keeps the map in step with the biome scope: it fits the view when a
 * scope is set (`biomeFitRequest`, also when it was set while the map was not shown) and drops a remembered scope the
 * dataset has no biome for. Rendered inside the map.
 */
export function BiomeLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const mobile = useIsMobile();
  const shapes = useBiomeShapes(ctx.me.datasetVersion);
  const scope = useUiStore(s => s.biomeScope);
  const fitRequest = useUiStore(s => s.biomeFitRequest);
  const setScope = useUiStore(s => s.setBiomeScope);

  // A scope remembered from an older dataset may name a biome this one does not have (the biomes changed):
  // drop it, or every marker would count as outside the scope.
  useEffect(() => {
    if (scope !== null && !ctx.index.ds.biomes[scope]) setScope(null);
  }, [scope, ctx.index, setScope]);

  const biomes = useMemo(() => shapes?.features.map(f => ({ idx: f.properties.idx, rings: ringsOf(f) })) ?? [], [shapes]);

  // Fit when the scope is set, not for a scope restored with the view (that keeps its viewport); a request made while
  // the map was not shown (a search result on a tool page, the list view) is carried out when it is.
  useEffect(() => {
    if (fitRequest === null) return;
    const rings = biomes.find(b => b.idx === fitRequest)?.rings;
    if (!rings) return;
    useUiStore.getState().clearBiomeFitRequest();
    // On mobile the lower half is under the bottom sheet the biome was picked in.
    const [px, py] = FIT_PADDING;
    map.fitBounds(ringBounds(rings), {
      paddingTopLeft: FIT_PADDING,
      paddingBottomRight: mobile ? [px, py + Math.round(map.getSize().y / 2)] : FIT_PADDING,
      animate: !prefersReducedMotion(),
    });
  }, [fitRequest, biomes, map, mobile]);

  return null;
}
