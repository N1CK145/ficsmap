import type { FactorySnapshot, SnapshotStation } from '../../../../shared/factory/snapshot.js';
import type { FrameRoute } from './FactoryCanvasLayer.js';
import type { Scene } from './scene.js';

/**
 * The road a vehicle drives between its stops, as polylines of world points: road segments form a graph by their end
 * points (joined within `snap` cm), each stop joins the road at its nearest end point, and consecutive stops are
 * linked by the shortest way (Dijkstra by length). A leg without a way along the roads is the straight line.
 */
export function routePath(snapshot: FactorySnapshot, stopIds: readonly string[], snap = 150): { x: number; y: number }[][] {
  const stations = new Map(snapshot.stations.map(s => [s.id, s]));
  const stops = stopIds.map(id => stations.get(id)).filter((s): s is SnapshotStation => !!s);
  if (stops.length < 2) return [];

  // Nodes: segment end points, merged on a grid of `snap` cm.
  const nodeOf = new Map<string, number>();
  const nodes: { x: number; y: number }[] = [];
  const node = (x: number, y: number) => {
    const key = `${Math.round(x / snap)},${Math.round(y / snap)}`;
    let n = nodeOf.get(key);
    if (n === undefined) { n = nodes.length; nodes.push({ x, y }); nodeOf.set(key, n); }
    return n;
  };
  const edges = new Map<number, { to: number; len: number; pts: { x: number; y: number }[] }[]>();
  const addEdge = (a: number, b: number, len: number, pts: { x: number; y: number }[]) => {
    (edges.get(a) ?? edges.set(a, []).get(a)!).push({ to: b, len, pts });
    (edges.get(b) ?? edges.set(b, []).get(b)!).push({ to: a, len, pts: [...pts].reverse() });
  };
  for (const s of snapshot.splines) {
    if (!/^Build_VehiclePath/i.test(s.cls) || s.pts.length < 6) continue;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 2 < s.pts.length; i += 3) pts.push({ x: s.pts[i]!, y: s.pts[i + 1]! });
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    addEdge(node(pts[0]!.x, pts[0]!.y), node(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y), len, pts);
  }
  const nearest = (s: SnapshotStation): number | null => {
    let best: number | null = null, bestD = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - s.x, n.y - s.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    // A station farther than 60 m from any road end is not on the road network.
    return bestD <= 6000 ? best : null;
  };

  const legs: { x: number; y: number }[][] = [];
  // A route is a loop: the last stop leads back to the first.
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i]!, b = stops[(i + 1) % stops.length]!;
    if (a.id === b.id) continue;
    const from = nearest(a), to = nearest(b);
    const way = from !== null && to !== null ? shortestWay(edges, nodes.length, from, to) : null;
    legs.push(way ? [{ x: a.x, y: a.y }, ...way, { x: b.x, y: b.y }] : [{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
  }
  return legs;
}

function shortestWay(
  edges: Map<number, { to: number; len: number; pts: { x: number; y: number }[] }[]>, count: number, from: number, to: number,
): { x: number; y: number }[] | null {
  const dist = new Float64Array(count).fill(Infinity);
  const prev = new Array<{ from: number; pts: { x: number; y: number }[] } | undefined>(count);
  const done = new Uint8Array(count);
  dist[from] = 0;
  // Road networks are small (a few hundred segments): a linear scan for the next node is fast enough.
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < count; i++) if (!done[i] && dist[i]! < best) { best = dist[i]!; u = i; }
    if (u < 0 || u === to) break;
    done[u] = 1;
    for (const e of edges.get(u) ?? []) {
      const d = best + e.len;
      if (d < dist[e.to]!) { dist[e.to] = d; prev[e.to] = { from: u, pts: e.pts }; }
    }
  }
  if (dist[to] === Infinity) return null;
  const parts: { x: number; y: number }[][] = [];
  for (let n = to; n !== from;) {
    const p = prev[n]!;
    parts.push(p.pts);
    n = p.from;
  }
  return parts.reverse().flat();
}

/**
 * The selected vehicle's way along the roads between its stops, in map units, and its stops with their numbers. A leg
 * into a stop where the vehicle moves nothing (0 /min) and that stop's badge are marked.
 */
export function vehicleRoute(scene: Scene, id: string): FrameRoute | null {
  const v = scene.vehicleById.get(id);
  if (!v || v.v.route.length === 0) return null;
  const zeroAt = new Set(v.flow.stops.filter(s => s.visit !== null && (s.visit.itemsPerMin ?? 0) <= 0).map(s => s.station));
  // The same stops `routePath` walks: known stations, consecutive pairs (back to the first), repeats skipped.
  const known = v.v.route.filter(sid => scene.stationById.has(sid));
  const targets: string[] = [];
  if (known.length >= 2) {
    for (let i = 0; i < known.length; i++) {
      const a = known[i]!, b = known[(i + 1) % known.length]!;
      if (a !== b) targets.push(b);
    }
  }
  const legs = routePath(scene.snapshot, v.v.route).map((leg, i) => {
    const pts = new Float32Array(leg.length * 2);
    leg.forEach((p, k) => { pts[k * 2] = scene.t.x(p.x); pts[k * 2 + 1] = scene.t.y(p.y); });
    return { pts, zero: zeroAt.has(targets[i] ?? '') };
  });
  const labels = new Map<string, number[]>();
  v.v.route.forEach((sid, i) => (labels.get(sid) ?? labels.set(sid, []).get(sid)!).push(i + 1));
  const stops = [...labels].flatMap(([sid, nums]) => {
    const st = scene.stationById.get(sid);
    return st ? [{ cx: st.cx, cy: st.cy, label: nums.join('·'), zero: zeroAt.has(sid) }] : [];
  });
  return { legs, stops };
}
