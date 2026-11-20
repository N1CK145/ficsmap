import type { FactorySnapshot, SnapshotPlayer } from './snapshot.js';
import { UNASSIGNED_PLAYER } from './stats.js';

/**
 * The statistics page's views of one snapshot: the world as a whole and each player. Players are grouped by name,
 * since a player's state id can change between saves (and a save can hold two states of one player).
 */

export type CountRow = [cls: string, count: number];
export interface BuiltRow { cls: string; built: number; dismantled: number; current?: number; max?: number }

export interface WorldStats {
  playTimeSec: number | null;
  killed: CountRow[];
  consumed: CountRow[];
  produced: CountRow[];
  crafted: CountRow[];
  pickedUp: CountRow[];
  built: BuiltRow[];
  totals: { killed: number; consumed: number; crafted: number; pickedUp: number; built: number; dismantled: number; current: number };
}

export interface PlayerStats {
  /** The display name; null for a player the save has no name for. */
  name: string | null;
  /** A stable key for the switch: the name, else the first state id. */
  key: string;
  /** The counts the game keeps without a player (`UNASSIGNED_PLAYER`): of player states that no longer exist. */
  unassigned?: true;
  ids: string[];
  pos: [number, number, number] | null;
  crafted: CountRow[];
  pickedUp: CountRow[];
  built: BuiltRow[];
  totals: { crafted: number; pickedUp: number; built: number; dismantled: number };
}

export interface StatsViews { world: WorldStats; players: PlayerStats[] }

const byCount = (a: CountRow, b: CountRow) => b[1] - a[1] || a[0].localeCompare(b[0]);
const sum = (rows: readonly CountRow[]) => rows.reduce((n, r) => n + r[1], 0);

function merge(rows: Iterable<CountRow>): CountRow[] {
  const m = new Map<string, number>();
  for (const [cls, n] of rows) m.set(cls, (m.get(cls) ?? 0) + n);
  return [...m].sort(byCount);
}

/** Null without statistics in the snapshot (saves imported before they were read). */
export function statsViews(s: Pick<FactorySnapshot, 'stats' | 'players' | 'meta'>): StatsViews | null {
  const st = s.stats;
  if (!st) return null;
  const builtWorld = st.built
    .map((b): BuiltRow => ({ cls: b.cls, built: b.total, dismantled: b.dismantled, current: b.current, max: b.max }))
    .sort((a, b) => b.built - a.built || a.cls.localeCompare(b.cls));
  const world: WorldStats = {
    playTimeSec: s.meta.playTimeSec ?? null,
    killed: [...st.killed].sort(byCount),
    consumed: [...st.consumed].sort(byCount),
    produced: [...st.produced].sort(byCount),
    crafted: merge(st.crafted.map(([, i, n]) => [i, n])),
    pickedUp: merge(st.pickedUp.map(([, i, n]) => [i, n])),
    built: builtWorld,
    totals: {
      killed: sum(st.killed), consumed: sum(st.consumed),
      crafted: st.crafted.reduce((n, r) => n + r[2], 0), pickedUp: st.pickedUp.reduce((n, r) => n + r[2], 0),
      built: builtWorld.reduce((n, b) => n + b.built, 0), dismantled: builtWorld.reduce((n, b) => n + b.dismantled, 0),
      current: builtWorld.reduce((n, b) => n + (b.current ?? 0), 0),
    },
  };

  // Every id the stats name, also ones without a player state in the save.
  const known = new Map<string, SnapshotPlayer>((s.players ?? []).map(p => [p.id, p]));
  const ids = new Set<string>(known.keys());
  for (const [p] of st.crafted) ids.add(p);
  for (const [p] of st.pickedUp) ids.add(p);
  for (const b of st.built) for (const [p] of b.by) ids.add(p);
  const groups = new Map<string, { name: string | null; ids: string[]; pos: [number, number, number] | null }>();
  for (const id of ids) {
    const p = known.get(id);
    const name = p?.name ?? null;
    const key = name ?? id;
    const g = groups.get(key) ?? groups.set(key, { name, ids: [], pos: null }).get(key)!;
    g.ids.push(id);
    if (p?.pos && !g.pos) g.pos = p.pos;
  }
  const players: PlayerStats[] = [];
  for (const [key, g] of groups) {
    const mine = new Set(g.ids);
    const crafted = merge(st.crafted.filter(r => mine.has(r[0])).map(([, i, n]) => [i, n]));
    const pickedUp = merge(st.pickedUp.filter(r => mine.has(r[0])).map(([, i, n]) => [i, n]));
    const built: BuiltRow[] = [];
    for (const b of st.built) {
      let bu = 0, di = 0;
      for (const [p, x, y] of b.by) if (mine.has(p)) { bu += x; di += y; }
      if (bu || di) built.push({ cls: b.cls, built: bu, dismantled: di });
    }
    built.sort((a, b) => b.built - a.built || a.cls.localeCompare(b.cls));
    const totals = {
      crafted: sum(crafted), pickedUp: sum(pickedUp),
      built: built.reduce((n, b) => n + b.built, 0), dismantled: built.reduce((n, b) => n + b.dismantled, 0),
    };
    // A player state the save keeps without anything done (e.g. someone who only joined once) is still listed.
    const entry: PlayerStats = { name: g.name, key, ids: g.ids, pos: g.pos, crafted, pickedUp, built, totals };
    if (key === UNASSIGNED_PLAYER) entry.unassigned = true;
    players.push(entry);
  }
  // Most active first; nameless ones after them, the unassigned counts last.
  players.sort((a, b) => Number(!!a.unassigned) - Number(!!b.unassigned) || Number(a.name === null) - Number(b.name === null) || b.totals.built - a.totals.built || (a.name ?? a.key).localeCompare(b.name ?? b.key));
  return { world, players };
}
