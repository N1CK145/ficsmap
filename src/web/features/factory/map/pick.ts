import { DOTS_BELOW } from './lod.js';
import { pickBuilding, type Scene } from './scene.js';
import type { FactoryLayer, FactorySelection } from './useFactoryMap.js';

/** Hit radius around vehicles and station symbols, CSS px. */
export const SYMBOL_HIT_PX = 12;

/**
 * What is under a map point (map units, `s` CSS px per map unit) among the shown layers: a vehicle, then a station
 * symbol, then a crate, then the smallest building whose outline holds the point (zoomed out, with a few px of slack
 * around its dot). Stations are buildings, so a station is picked as its building.
 */
export function pickFactory(
  scene: Scene, layers: Readonly<Record<FactoryLayer, boolean>>, mx: number, my: number, s: number, zoom: number,
): FactorySelection | null {
  const r = SYMBOL_HIT_PX / s;
  if (layers.roads) {
    let best: FactorySelection | null = null, bestD = r;
    for (const v of scene.vehicles) {
      const d = Math.hypot(v.cx - mx, v.cy - my);
      if (d <= bestD) { bestD = d; best = { kind: 'vehicle', id: v.v.id }; }
    }
    for (const st of scene.stations) {
      const d = Math.hypot(st.cx - mx, st.cy - my);
      if (d < bestD) { bestD = d; best = { kind: 'building', id: st.s.id }; }
    }
    if (best) return best;
  }
  if (layers.crates) {
    let best: FactorySelection | null = null, bestD = r;
    for (const c of scene.crates) {
      const d = Math.hypot(c.cx - mx, c.cy - my);
      if (d <= bestD) { bestD = d; best = { kind: 'crate', id: c.id }; }
    }
    if (best) return best;
  }
  if (!layers.buildings) return null;
  const slack = (zoom < DOTS_BELOW ? 5 : 2) / s;
  const sb = pickBuilding(scene, mx, my, slack);
  if (!sb) return null;
  // Zoomed out only the machines are dots; the rest is not drawn and not picked.
  if (zoom < DOTS_BELOW && !sb.b.prod && (sb.kind === 'logistics' || sb.kind === 'building')) return null;
  return { kind: 'building', id: sb.b.id };
}
