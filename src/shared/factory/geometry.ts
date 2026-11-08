/**
 * Geometry for the factory snapshot: actor transforms (quaternion + translation), the spline curves of belts, pipes,
 * hypertubes and vehicle paths, and polyline simplification. Pure and allocation-light; the save worker runs it over
 * thousands of splines.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export interface Transform { rotation: Quat; translation: Vec3 }

const RAD_TO_DEG = 180 / Math.PI;

/** Rotation about z in degrees, rounded to 0.1, in [-180, 180]; 0 = facing +x. */
export function yawOf(q: Quat): number {
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * RAD_TO_DEG;
  const r = Math.round(yaw * 10) / 10;
  return r === 0 ? 0 : r; // no -0 in JSON
}

/** `v` rotated by the unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w (q × v) + 2 q × (q × v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** A point local to an actor (scale 1, as buildables are) in world space. */
export function toWorld(t: Transform, local: Vec3): Vec3 {
  const r = rotate(t.rotation, local);
  return { x: r.x + t.translation.x, y: r.y + t.translation.y, z: r.z + t.translation.z };
}

/** One point of a spline as the save stores it (`SplinePointData`): location and tangents, local to the actor. */
export interface SplinePoint { location: Vec3; arrive: Vec3; leave: Vec3 }

/** Sample spacing along a curved spline segment (game units); straight segments get no samples in between. */
const SAMPLE_STEP = 200;
const MAX_SAMPLES = 48;

/**
 * The spline as a dense local polyline: the game's cubic Hermite curve (`FMath::CubicInterp(P0, leave0, P1,
 * arrive1, t)`) between consecutive points, sampled about every 2 m where it bends.
 */
export function sampleSpline(points: readonly SplinePoint[]): Vec3[] {
  const out: Vec3[] = [];
  if (points.length === 0) return out;
  out.push(points[0]!.location);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const p0 = a.location, p1 = b.location, t0 = a.leave, t1 = b.arrive;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const len = Math.hypot(dx, dy, dz);
    // Straight when both tangents point along the chord: the curve is then the segment itself.
    const straight = len > 0 && isAlong(t0, dx, dy, dz, len) && isAlong(t1, dx, dy, dz, len);
    const n = straight ? 1 : Math.min(MAX_SAMPLES, Math.max(4, Math.ceil(len / SAMPLE_STEP)));
    for (let s = 1; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push({
        x: h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x,
        y: h00 * p0.y + h10 * t0.y + h01 * p1.y + h11 * t1.y,
        z: h00 * p0.z + h10 * t0.z + h01 * p1.z + h11 * t1.z,
      });
    }
    out.push(p1);
  }
  return out;
}

function isAlong(t: Vec3, dx: number, dy: number, dz: number, len: number): boolean {
  const tl = Math.hypot(t.x, t.y, t.z);
  if (tl === 0) return true;
  return (t.x * dx + t.y * dy + t.z * dz) / (tl * len) > 0.99999;
}

/** Squared distance of p from the segment a–b. */
function segDist2(p: Vec3, a: Vec3, b: Vec3): number {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z;
  const l2 = vx * vx + vy * vy + vz * vz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / l2));
  const ex = wx - t * vx, ey = wy - t * vy, ez = wz - t * vz;
  return ex * ex + ey * ey + ez * ez;
}

/** Douglas–Peucker in 3D: keeps the end points and every point further than `tolerance` from the simplified line. */
export function simplify(points: readonly Vec3[], tolerance: number): Vec3[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    let worst = -1, worstD = tol2;
    for (let i = from + 1; i < to; i++) {
      const d = segDist2(points[i]!, points[from]!, points[to]!);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([from, worst], [worst, to]);
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Whole game units, no -0. */
export function roundUnit(v: number): number {
  const r = Math.round(v);
  return r === 0 ? 0 : r;
}

/** A world-space polyline as the snapshot stores it: flat x, y, z in whole units, consecutive duplicates dropped. */
export function flatPolyline(points: readonly Vec3[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    const x = roundUnit(p.x), y = roundUnit(p.y), z = roundUnit(p.z);
    const n = out.length;
    if (n >= 3 && out[n - 3] === x && out[n - 2] === y && out[n - 1] === z) continue;
    out.push(x, y, z);
  }
  return out;
}
