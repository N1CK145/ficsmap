import { readBool, shortName } from '../extract.js';
import type { FactoryObject } from './extract.js';
import { roundUnit } from './geometry.js';
import type { SnapshotBuiltStat, SnapshotPlayer, SnapshotStats } from './snapshot.js';

/**
 * Players, creature spawners and the game's statistics of a save (`extractFactory` collects the objects and calls
 * these). Map properties arrive from the parser as `values: [key, value][]`, keys as object references
 * (`{ pathName }`), int64 values as strings.
 */

type Prop = { value?: unknown; values?: unknown; flags?: number };
type Props = Record<string, Prop>;

const MAX_ENTRIES = 5_000;

/**
 * The player of counts the game keeps under an empty player reference: those of a player state that no longer exists
 * (the game makes a new one for a player now and then, and the old one's counts stay, without an owner).
 */
export const UNASSIGNED_PLAYER = '?';
const MAX_NAME = 128;

function props(v: unknown): Props | undefined {
  const o = v as { properties?: Props; value?: { properties?: Props } } | undefined;
  return o?.properties ?? o?.value?.properties;
}

function pathOf(v: unknown): string | undefined {
  const p = (v as { pathName?: unknown } | undefined)?.pathName;
  return typeof p === 'string' && p !== '' ? p : undefined;
}

/** A class reference → `Desc_Nut_C`; an actor reference → its actor name. */
function nameOf(v: unknown): string | undefined {
  const p = pathOf(v);
  if (!p) return undefined;
  const n = shortName(p);
  return n === '' || n === 'None' ? undefined : n;
}

/** A count as the parser gives it: number, int64 string, or a property holding one. Undefined unless a finite integer ≥ 0. */
function count(v: unknown): number | undefined {
  const raw = v !== null && typeof v === 'object' && 'value' in v ? (v as Prop).value : v;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

function entries(p: Prop | undefined): [unknown, unknown][] {
  const list = p?.values;
  return Array.isArray(list) ? (list.filter(e => Array.isArray(e) && e.length === 2) as [unknown, unknown][]).slice(0, MAX_ENTRIES) : [];
}

/** `TMap<class, int>` → `[class, count][]`, zero counts left out. */
function classCounts(p: Prop | undefined): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, v] of entries(p)) {
    const cls = nameOf(k), n = count(v);
    if (cls && n) out.push([cls, n]);
  }
  return out;
}

/** A player state reference → its actor name; an empty one → UNASSIGNED_PLAYER. */
function playerOf(v: unknown): string {
  return nameOf(v) ?? UNASSIGNED_PLAYER;
}

/** `TMap<player state, FMappedItemAmount>` → `[player, item, count][]` (one player can come several times). */
function perPlayerItems(p: Prop | undefined): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (const [k, v] of entries(p)) {
    const player = playerOf(k);
    for (const [item, n] of classCounts(props(v)?.ItemAmounts)) out.push([player, item, n]);
  }
  return out;
}

function builtStats(p: Prop | undefined): SnapshotBuiltStat[] {
  const out: SnapshotBuiltStat[] = [];
  for (const [k, v] of entries(p)) {
    const cls = nameOf(k), d = props(v);
    if (!cls || !d) continue;
    const by = new Map<string, [string, number, number]>();
    const row = (player: string) => by.get(player) ?? by.set(player, [player, 0, 0]).get(player)!;
    for (const [pk, n] of entries(d.BuiltPerPlayer)) { const c = count(n); if (c) row(playerOf(pk))[1] += c; }
    for (const [pk, n] of entries(d.DismantledPerPlayer)) { const c = count(n); if (c) row(playerOf(pk))[2] += c; }
    const stat: SnapshotBuiltStat = {
      cls, total: count(d.Total) ?? 0, dismantled: count(d.TotalDismantled) ?? 0, current: count(d.Current) ?? 0, max: count(d.CurrentMax) ?? 0,
      by: [...by.values()],
    };
    if (stat.total || stat.dismantled || stat.current || stat.by.length) out.push(stat);
  }
  return out;
}

/** The statistics subsystem's counts. */
export function readStats(o: FactoryObject): SnapshotStats {
  const p = (o.properties ?? {}) as Props;
  return {
    consumed: classCounts(p.mConsumablesConsumedCount),
    killed: classCounts(p.mCreaturesKilledCount),
    produced: classCounts(p.mItemsProduced),
    crafted: perPlayerItems(p.mItemsManuallyCraftedCount),
    pickedUp: perPlayerItems(p.mItemsPickedUp),
    built: builtStats(p.mActorsBuiltCount),
  };
}

/**
 * A spawner with a kill: `[name, times killed, dead now, last kill's game day?]`; undefined when none of its creatures
 * was ever killed. The day is the highest `KilledOnDayNr`: the game sets it while a creature is dead and puts it back
 * to -1 when it comes back, so only spawners with dead creatures have one.
 */
export function readSpawner(o: FactoryObject): [string, number, number, number?] | undefined {
  const list = (o.properties as Props | undefined)?.mSpawnData?.values;
  if (!Array.isArray(list)) return undefined;
  let kills = 0, dead = 0, day = -1;
  for (const e of list) {
    const d = props(e);
    if (!d) continue;
    kills += count(d.NumTimesKilled) ?? 0;
    if (readBool(d.WasKilled as { value?: unknown; flags?: number })) dead++;
    const k = (d.KilledOnDayNr as Prop | undefined)?.value;
    if (typeof k === 'number' && Number.isInteger(k) && k > day) day = k;
  }
  if (kills === 0 && dead === 0) return undefined;
  const out: [string, number, number, number?] = [shortName(o.instanceName), Math.max(kills, dead), dead];
  if (day >= 0) out.push(day);
  return out;
}

/**
 * The players: every player state, named after its character (`Char_Player_C.mCachedPlayerName`), else after the game
 * state's player info cache (`mPlayerInfoCache[mPlatformPlayerInfoHandle.playerInfoTableIndex]`, first name in it), and
 * placed where its character is.
 */
export function readPlayers(states: readonly FactoryObject[], byName: ReadonlyMap<string, FactoryObject>, gameState: FactoryObject | undefined): SnapshotPlayer[] {
  const cache = (gameState?.properties as Props | undefined)?.mPlayerInfoCache?.values;
  const cachedName = (i: unknown): string | undefined => {
    if (typeof i !== 'number' || !Array.isArray(cache)) return undefined;
    const per = props(cache[i])?.PerPlatformInfo?.values;
    if (!Array.isArray(per)) return undefined;
    for (const pi of per) {
      const n = props(pi)?.PlayerName?.value;
      if (typeof n === 'string' && n.trim()) return n;
    }
    return undefined;
  };
  const out: SnapshotPlayer[] = [];
  for (const s of states) {
    const p = (s.properties ?? {}) as Props;
    const player: SnapshotPlayer = { id: shortName(s.instanceName) };
    const pawnPath = pathOf(p.mOwnedPawn?.value);
    const pawn = pawnPath ? byName.get(pawnPath) : undefined;
    const pawnName = (pawn?.properties as Props | undefined)?.mCachedPlayerName?.value;
    const handle = p.mPlatformPlayerInfoHandle?.value as { playerInfoTableIndex?: unknown } | undefined;
    const name = typeof pawnName === 'string' && pawnName.trim() ? pawnName : cachedName(handle?.playerInfoTableIndex);
    if (name) player.name = name.slice(0, MAX_NAME);
    const t = pawn?.transform?.translation;
    if (t) player.pos = [roundUnit(t.x), roundUnit(t.y), roundUnit(t.z)];
    out.push(player);
  }
  return out;
}
