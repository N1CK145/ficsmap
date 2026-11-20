/**
 * A factory snapshot as the difference to another one of the same world (the "base"), so the timeline downloads only
 * what changed between two saves (about a tenth of a snapshot) and the browser keeps one copy of what did not.
 *
 * Every top-level array of objects is described by runs over the base's array: copy `len` elements from the base
 * starting at `from`, then append `add` new ones (`runs` = [from, len, add, from, len, add, ...]); the new elements
 * follow in `add`, in order. Elements are compared by their JSON text, so a moved element is still copied. An array
 * that is unchanged is not listed at all and stays the very same array; arrays of plain values (the power lines'
 * flat coordinates) are replaced whole when they differ. Other top-level fields that differ go in `set`; `keys` are
 * the target's top-level fields in their order (a field the base lacks or the target dropped).
 *
 * `applyDelta` rebuilds the target with the base's own objects for everything copied (structural sharing): ten
 * consecutive saves cost little more memory than one. Snapshots are never mutated after loading, so sharing is safe.
 */

/** Format version of `SnapshotDelta`; a client that gets a newer one fetches the whole snapshot instead. */
export const SNAPSHOT_DELTA_VERSION = 1;

export interface ArrayPatch {
  runs: number[];
  add: unknown[];
}

export interface SnapshotDelta {
  delta: typeof SNAPSHOT_DELTA_VERSION;
  /** The base snapshot's id. */
  base: number;
  /** The target snapshot's id. */
  id: number;
  /** The target's top-level fields, in order. */
  keys: string[];
  arrays: Record<string, ArrayPatch>;
  set: Record<string, unknown>;
}

type Obj = Record<string, unknown>;

/** Whether the array holds objects or arrays (patched by element) rather than plain values (replaced whole). */
function ofElements(a: readonly unknown[]): boolean {
  return a.length > 0 && typeof a[0] === 'object' && a[0] !== null;
}

/**
 * The JSON text of every element of an array, cached per array: consecutive deltas share their middle snapshot, and
 * a copied array is the same array in base and target.
 */
const textCache = new WeakMap<readonly unknown[], string[]>();
function texts(a: readonly unknown[]): string[] {
  let t = textCache.get(a);
  if (!t) {
    t = a.map(x => JSON.stringify(x));
    textCache.set(a, t);
  }
  return t;
}

/** The runs and new elements that make `target` from `base`; null when they are equal. */
export function diffArray(base: readonly unknown[], target: readonly unknown[]): ArrayPatch | null {
  const bt = texts(base), tt = texts(target);
  if (bt.length === tt.length && bt.every((s, i) => s === tt[i])) return null;
  // Where each text lies in the base, in order; equal elements are used up one by one.
  const at = new Map<string, number[]>();
  bt.forEach((s, i) => (at.get(s) ?? at.set(s, []).get(s)!).push(i));
  const used = new Uint8Array(bt.length);
  const runs: number[] = [];
  const add: unknown[] = [];
  let from = -1, len = 0, added = 0;
  const flush = () => {
    if (len > 0 || added > 0) runs.push(Math.max(0, from), len, added);
    from = -1; len = 0; added = 0;
  };
  for (let j = 0; j < tt.length; j++) {
    const s = tt[j]!;
    // Prefer continuing the current run; otherwise the first unused equal element.
    let i = -1;
    const next = from >= 0 ? from + len : -1;
    if (added === 0 && next >= 0 && next < bt.length && !used[next] && bt[next] === s) i = next;
    else {
      const list = at.get(s);
      while (list && list.length > 0 && used[list[0]!]) list.shift();
      if (list && list.length > 0) i = list[0]!;
    }
    if (i < 0) {
      add.push(target[j]);
      added++;
      continue;
    }
    used[i] = 1;
    if (added === 0 && i === next) { len++; continue; }
    flush();
    from = i; len = 1;
  }
  flush();
  return { runs, add };
}

/** The delta that makes `target` (id `id`) from `base` (id `baseId`). */
export function diffSnapshots(base: Obj, target: Obj, baseId: number, id: number): SnapshotDelta {
  const d: SnapshotDelta = { delta: SNAPSHOT_DELTA_VERSION, base: baseId, id, keys: Object.keys(target), arrays: {}, set: {} };
  for (const [k, v] of Object.entries(target)) {
    const b = base[k];
    if (Array.isArray(v) && Array.isArray(b) && ofElements(v) && ofElements(b)) {
      const p = diffArray(b, v);
      if (p) d.arrays[k] = p;
    } else if (!(k in base) || JSON.stringify(b) !== JSON.stringify(v)) {
      d.set[k] = v;
    }
  }
  return d;
}

/** Whether a value looks like a `SnapshotDelta` this code can apply (fields checked, not every element). */
export function isSnapshotDelta(x: unknown): x is SnapshotDelta {
  const d = x as Partial<SnapshotDelta> | null;
  return !!d && d.delta === SNAPSHOT_DELTA_VERSION && Number.isInteger(d.base) && Number.isInteger(d.id)
    && Array.isArray(d.keys) && d.keys.every(k => typeof k === 'string')
    && !!d.arrays && typeof d.arrays === 'object' && !!d.set && typeof d.set === 'object';
}

/**
 * Rebuilds the target of `d` from `base`, reusing the base's objects and unchanged arrays. Throws on a delta that
 * does not fit the base (runs outside its arrays, too few new elements).
 */
export function applyDelta<T extends object>(base: T, d: SnapshotDelta): T {
  const b = base as unknown as Obj;
  const out: Obj = {};
  for (const k of d.keys) {
    if (Object.hasOwn(d.set, k)) { out[k] = d.set[k]; continue; }
    const p = d.arrays[k];
    if (!p) {
      if (!Object.hasOwn(b, k)) throw new Error(`Snapshot delta does not fit its base: ${k}`);
      out[k] = b[k];
      continue;
    }
    const src = b[k];
    if (!Array.isArray(src) || p.runs.length % 3 !== 0) throw new Error(`Snapshot delta does not fit its base: ${k}`);
    const arr: unknown[] = [];
    let a = 0;
    for (let r = 0; r < p.runs.length; r += 3) {
      const from = p.runs[r]!, len = p.runs[r + 1]!, added = p.runs[r + 2]!;
      if (from < 0 || len < 0 || from + len > src.length || a + added > p.add.length) throw new Error(`Snapshot delta does not fit its base: ${k}`);
      for (let i = from; i < from + len; i++) arr.push(src[i]);
      for (let i = 0; i < added; i++) arr.push(p.add[a++]);
    }
    if (a !== p.add.length) throw new Error(`Snapshot delta does not fit its base: ${k}`);
    out[k] = arr;
  }
  return out as T;
}
