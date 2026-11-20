/**
 * Creature spawners: the dataset file `creatures.json` (built from the extractor's `collectibles.json`
 * `creatureSpawners`: actor name, creature class, location), the creature families of the map layer's filter, and
 * the kill state a save reports (`FactorySnapshot.spawners`).
 */

/** `[actor name, creature class, x, y, z]`; coordinates in world units (cm), rounded. */
export type CreatureSpawnerTuple = [name: string, creature: string, x: number, y: number, z: number];

/** `/data/<v>/creatures.json`. */
export interface CreaturesFile {
  version: string;
  spawners: CreatureSpawnerTuple[];
}

export type CreatureFamily = 'hog' | 'spitter' | 'stinger' | 'hatcher' | 'wildlife';
/** Order = the filter's order. */
export const CREATURE_FAMILIES: readonly CreatureFamily[] = ['hog', 'spitter', 'stinger', 'hatcher', 'wildlife'];

/** Hostile families first; wildlife does not attack. */
export function creatureFamily(cls: string): CreatureFamily {
  if (/Hog/.test(cls)) return 'hog';
  if (/Spitter/.test(cls)) return 'spitter';
  if (/Stinger/.test(cls)) return 'stinger';
  if (/CrabHatcher/.test(cls)) return 'hatcher';
  return 'wildlife';
}

export interface CreatureSpawner {
  name: string;
  creature: string;
  family: CreatureFamily;
  x: number;
  y: number;
  z: number;
}

export function readCreatures(file: CreaturesFile): CreatureSpawner[] {
  return file.spawners.map(([name, creature, x, y, z]) => ({ name, creature, family: creatureFamily(creature), x, y, z }));
}

/** What a save says about one spawner: times killed over its spawn points, how many are dead right now, the last kill's game day. */
export interface SpawnerKills { kills: number; dead: number; lastDay?: number }

export function killsByName(spawners: readonly (readonly [string, number, number, number?])[] | undefined): ReadonlyMap<string, SpawnerKills> {
  return new Map((spawners ?? []).map(([name, kills, dead, lastDay]) => [name, lastDay === undefined ? { kills, dead } : { kills, dead, lastDay }]));
}

/**
 * The kill figures of a save in one place, so the panel and the Statistik page say the same: kills and creatures dead
 * now over the spawners, the spawners with a kill, and the game's own kill total (which also counts creatures that
 * came from no spawner, e.g. from a crab hatcher), null without statistics.
 */
export function killSummary(kills: ReadonlyMap<string, SpawnerKills>, statsKilled: number | null) {
  let onSpawners = 0, dead = 0;
  for (const k of kills.values()) { onSpawners += k.kills; dead += k.dead; }
  return { kills: onSpawners, spawners: kills.size, dead, total: statsKilled, withoutSpawner: statsKilled === null ? 0 : Math.max(0, statsKilled - onSpawners) };
}

/** `dead`: dead right now; `back`: killed before and alive again; `untouched`: never killed. */
export type KillState = 'dead' | 'back' | 'untouched';

export function killState(k: SpawnerKills | undefined): KillState {
  if (!k || k.kills === 0) return 'untouched';
  return k.dead > 0 ? 'dead' : 'back';
}

export function buildCreatures(raw: unknown, version: string): CreaturesFile {
  const list = (raw as { creatureSpawners?: unknown } | undefined)?.creatureSpawners;
  if (!Array.isArray(list)) throw new Error('collectibles.json has no creatureSpawners');
  const spawners: CreatureSpawnerTuple[] = [];
  for (const e of list as { name?: unknown; creature?: unknown; location?: unknown }[]) {
    const loc = e.location;
    if (typeof e.name !== 'string' || typeof e.creature !== 'string' || !Array.isArray(loc) || loc.length < 3) continue;
    const [x, y, z] = loc.map(Number);
    if (![x, y, z].every(Number.isFinite)) continue;
    spawners.push([e.name, e.creature, Math.round(x!), Math.round(y!), Math.round(z!)]);
  }
  return { version, spawners: spawners.sort((a, b) => a[0].localeCompare(b[0])) };
}
