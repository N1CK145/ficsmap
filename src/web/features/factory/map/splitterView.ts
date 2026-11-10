import { rulesBySide, sideOfPort, splitterSides, SORT_FILTERS, type SplitterSide } from '../../../../shared/factory/splitter.js';
import { sceneLineById } from './lineView.js';
import type { Scene, SceneBuilding } from './scene.js';

/*
 * A smart or programmable splitter on the map (pure): per output the belt to the next building and what its rules send
 * there, so the map can draw where each output leads and the popup can name it.
 */

export interface SplitterOutput {
  side: SplitterSide;
  /** Item classes of its rules, filters (`SORT_FILTERS`) included; empty when no rule names this output. */
  items: string[];
  /** The next building its belt reaches, when one is connected. */
  target: SceneBuilding | undefined;
  /** The belt's polylines (x, y per point, map units) from the splitter on. */
  paths: Float32Array[];
}

/** Has sort rules in the snapshot (smart, programmable and their lift variants). */
export function isSortingSplitter(sb: SceneBuilding | undefined): boolean {
  return sb?.b.sort !== undefined;
}

export const isFilterItem = (item: string): boolean => (SORT_FILTERS as readonly string[]).includes(item);

const cache = new WeakMap<Scene, Map<string, SplitterOutput[]>>();

/** The splitter's outputs in the order the game shows them (left, centre or top, right). */
export function splitterOutputs(scene: Scene, sb: SceneBuilding): SplitterOutput[] {
  let perScene = cache.get(scene);
  if (!perScene) cache.set(scene, (perScene = new Map()));
  const hit = perScene.get(sb.b.id);
  if (hit) return hit;
  const cls = sb.b.cls;
  const rules = rulesBySide(cls, sb.b.sort ?? []);
  const lines = sceneLineById(scene);
  const out = splitterSides(cls).map((side): SplitterOutput => ({ side, items: rules.get(side) ?? [], target: undefined, paths: [] }));
  for (const l of scene.snapshot.links ?? []) {
    if (l.from !== sb.b.id || l.kind !== 'belt') continue;
    const o = out.find(x => x.side === sideOfPort(cls, l.fromPort));
    if (!o) continue;
    o.target = scene.byId.get(l.to);
    for (const id of l.via) {
      const line = lines.get(id);
      if (line) o.paths.push(line.pts);
    }
  }
  perScene.set(sb.b.id, out);
  return out;
}
