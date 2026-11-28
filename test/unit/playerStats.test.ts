import { describe, expect, it } from 'vitest';
import { buildCreatures, creatureFamily, creaturesByBiome, killsByName, killState, killSummary, readCreatures } from '../../src/shared/creatures.js';
import { readPlayers, readSpawner, readStats, UNASSIGNED_PLAYER } from '../../src/shared/factory/stats.js';
import { statsViews } from '../../src/shared/factory/statsView.js';
import { countDeaths, deathCrateHistory, deathCrates } from '../../src/shared/factory/storage.js';
import type { FactoryObject } from '../../src/shared/factory/extract.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';

const cls = (path: string) => ({ levelName: '', pathName: path });
const actor = (name: string) => ({ levelName: 'Persistent_Level', pathName: `Persistent_Level:PersistentLevel.${name}` });
const struct = (properties: Record<string, unknown>) => ({ type: 'StructProperty', properties });
const P1 = 'BP_PlayerState_C_1';
const P2 = 'BP_PlayerState_C_2';

// The shapes @etothepii/satisfactory-file-parser 4.1.2 gives for FGStatisticsSubsystem (checked on a 1.2 save).
const statistics: FactoryObject = {
  typePath: '/Script/FactoryGame.FGStatisticsSubsystem',
  instanceName: 'Persistent_Level:PersistentLevel.StatisticsSubsystem',
  properties: {
    mConsumablesConsumedCount: { values: [[cls('/Game/Nut/Desc_Nut.Desc_Nut_C'), 212], [cls('/Game/Berry/Desc_Berry.Desc_Berry_C'), 0]] } as never,
    mCreaturesKilledCount: { values: [[cls('/Game/Hog/Char_Hog.Char_Hog_C'), 94], [cls('/Game/Stinger/Char_Stinger_Child.Char_Stinger_Child_C'), 42]] } as never,
    mItemsManuallyCraftedCount: { values: [[actor(P1), struct({ ItemAmounts: { values: [[cls('/Game/Desc_IronPlate.Desc_IronPlate_C'), 200]] } })]] } as never,
    mItemsPickedUp: { values: [
      [actor(P1), struct({ ItemAmounts: { values: [[cls('/Game/Desc_Leaves.Desc_Leaves_C'), 15]] } })],
      [actor(P2), struct({ ItemAmounts: { values: [[cls('/Game/Desc_Leaves.Desc_Leaves_C'), 5]] } })],
      // A player state that no longer exists: the game keeps its counts under an empty reference.
      [{ levelName: '', pathName: '' }, struct({ ItemAmounts: { values: [[cls('/Game/Desc_Leaves.Desc_Leaves_C'), 2]] } })],
    ] } as never,
    mActorsBuiltCount: { values: [[cls('/Game/Build_ConstructorMk1.Build_ConstructorMk1_C'), struct({
      BuiltPerPlayer: { values: [[actor(P1), '7'], [actor(P2), '3']] },
      DismantledPerPlayer: { values: [[actor(P2), '1']] },
      Current: { value: '9' }, CurrentMax: { value: '10' }, Total: { value: '10' }, TotalDismantled: { value: '1' },
    })]] } as never,
  },
};

describe('readStats', () => {
  it('reads counts per class and per player as the parser gives them, int64 strings included; zero counts left out', () => {
    const s = readStats(statistics);
    expect(s.consumed).toEqual([['Desc_Nut_C', 212]]);
    expect(s.killed).toEqual([['Char_Hog_C', 94], ['Char_Stinger_Child_C', 42]]);
    expect(s.crafted).toEqual([[P1, 'Desc_IronPlate_C', 200]]);
    expect(s.pickedUp).toEqual([[P1, 'Desc_Leaves_C', 15], [P2, 'Desc_Leaves_C', 5], [UNASSIGNED_PLAYER, 'Desc_Leaves_C', 2]]);
    expect(s.produced).toEqual([]);
    expect(s.built).toEqual([{ cls: 'Build_ConstructorMk1_C', total: 10, dismantled: 1, current: 9, max: 10, by: [[P1, 7, 0], [P2, 3, 1]] }]);
  });
});

describe('readSpawner', () => {
  const spawner = (points: { killed: number; dead: boolean; day?: number }[]): FactoryObject => ({
    typePath: '/Game/BP_CreatureSpawner.BP_CreatureSpawner_C', instanceName: 'Persistent_Level:PersistentLevel.BP_CreatureSpawner412',
    properties: { mSpawnData: { values: points.map(p => struct({
      NumTimesKilled: { value: p.killed },
      // UE 5.4+: a true bool is the tag flag 0x10 and the parser reports false.
      WasKilled: p.dead ? { value: false, flags: 16 } : { value: false },
      KilledOnDayNr: { value: p.day ?? -1 },
    })) } as never },
  });
  it('sums the kills over the spawn points, counts the dead ones (bool flag 0x10) and keeps the last kill day', () => {
    expect(readSpawner(spawner([{ killed: 2, dead: true, day: 79 }, { killed: 1, dead: false, day: 62 }, { killed: 0, dead: false }]))).toEqual(['BP_CreatureSpawner412', 3, 1, 79]);
    expect(readSpawner(spawner([{ killed: 1, dead: false }]))).toEqual(['BP_CreatureSpawner412', 1, 0]);
  });
  it('leaves out spawners without a kill', () => {
    expect(readSpawner(spawner([{ killed: 0, dead: false }]))).toBeUndefined();
  });
});

describe('readPlayers', () => {
  it('names a player after its character, else after the player info cache, and places it where its character is', () => {
    const pawn: FactoryObject = {
      typePath: '/Game/Char_Player.Char_Player_C', instanceName: 'Persistent_Level:PersistentLevel.Char_Player_C_9',
      properties: { mCachedPlayerName: { value: 'Reinsch' } },
      transform: { translation: { x: 100.4, y: -200.6, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale3d: { x: 1, y: 1, z: 1 } },
    } as FactoryObject;
    const states: FactoryObject[] = [
      { typePath: '/Game/BP_PlayerState.BP_PlayerState_C', instanceName: `Persistent_Level:PersistentLevel.${P1}`,
        properties: { mOwnedPawn: { value: actor('Char_Player_C_9') }, mPlatformPlayerInfoHandle: { value: { playerInfoTableIndex: 0 } } } },
      { typePath: '/Game/BP_PlayerState.BP_PlayerState_C', instanceName: `Persistent_Level:PersistentLevel.${P2}`,
        properties: { mPlatformPlayerInfoHandle: { value: { serviceProvider: 1, playerInfoTableIndex: 1 } } } },
    ];
    const gameState = { typePath: '/Game/BP_GameState.BP_GameState_C', instanceName: 'gs', properties: { mPlayerInfoCache: { values: [
      struct({ PerPlatformInfo: { values: [struct({ PlayerName: { value: 'Old name' } })] } }),
      struct({ PerPlatformInfo: { values: [struct({ PlayerName: { value: '' } }), struct({ PlayerName: { value: 'N1CK145' } })] } }),
    ] } } } as unknown as FactoryObject;
    const byName = new Map([[pawn.instanceName, pawn]]);
    expect(readPlayers(states, byName, gameState)).toEqual([
      { id: P1, name: 'Reinsch', pos: [100, -201, 3] },
      { id: P2, name: 'N1CK145' },
    ]);
  });
});

describe('statsViews', () => {
  const snap = (players: FactorySnapshot['players']): Pick<FactorySnapshot, 'stats' | 'players' | 'meta'> => ({
    meta: { sessionName: 's', saveTime: 0, build: 0, playTimeSec: 3600 },
    players,
    stats: readStats(statistics),
  });

  it('sums the world and splits per player, most active first', () => {
    const v = statsViews(snap([{ id: P1, name: 'Reinsch', pos: [1, 2, 3] }, { id: P2, name: 'N1CK145' }]))!;
    expect(v.world.totals).toEqual({ killed: 136, consumed: 212, crafted: 200, pickedUp: 22, built: 10, dismantled: 1, current: 9 });
    expect(v.world.pickedUp).toEqual([['Desc_Leaves_C', 22]]);
    // The unassigned counts last, so the players add up to the world.
    expect(v.players.map(p => [p.name, p.unassigned ?? false, p.totals])).toEqual([
      ['Reinsch', false, { crafted: 200, pickedUp: 15, built: 7, dismantled: 0 }],
      ['N1CK145', false, { crafted: 0, pickedUp: 5, built: 3, dismantled: 1 }],
      [null, true, { crafted: 0, pickedUp: 2, built: 0, dismantled: 0 }],
    ]);
    expect(v.players[0]!.pos).toEqual([1, 2, 3]);
  });

  it('joins two player states with the same name, and keeps ids without a state as unnamed players last', () => {
    const v = statsViews(snap([{ id: P1, name: 'Reinsch' }, { id: P2, name: 'Reinsch' }]))!;
    expect(v.players.map(p => p.name)).toEqual(['Reinsch', null]);
    expect(v.players[0]!.totals.built).toBe(10);
    const w = statsViews(snap([{ id: P1, name: 'Reinsch' }]))!;
    expect(w.players.map(p => [p.name, p.unassigned ?? false])).toEqual([['Reinsch', false], [null, false], [null, true]]);
  });

  it('is null for a snapshot without statistics', () => {
    expect(statsViews({ meta: { sessionName: 's', saveTime: 0, build: 0 } })).toBeNull();
  });
});

describe('deaths', () => {
  const crate = (id: string, kind: string) => ({ id, x: 0, y: 0, z: 0, kind });
  it('takes the death crates of a save, not the dismantle crates', () => {
    expect(deathCrates({ crates: [crate('b', 'CT_DeathCrate'), crate('c', 'unknown'), crate('a', 'CT_DeathCrate')] })).toEqual([['a', 0, 0, 0], ['b', 0, 0, 0]]);
  });
  it('counts distinct crates up to a save; a snapshot without the record makes it partial', () => {
    const at = (id: string): [string, number, number, number] => [id, 1, 2, 3];
    const list = [{ saveTime: 1, deathCrates: [at('a'), at('b')] }, { saveTime: 2, deathCrates: [at('b'), at('c')] }, { saveTime: 3, deathCrates: [at('d')] }];
    expect(countDeaths(list, 2)).toEqual({ deaths: 3, known: true });
    expect(countDeaths(list, 3)).toEqual({ deaths: 4, known: true });
    expect(countDeaths([{ saveTime: 1 }, { saveTime: 2, deathCrates: [at('a')] }], 2)).toEqual({ deaths: 1, known: false });
    // Each crate once, with the first and last save it lay in: a and b are gone by save 2 and 3.
    expect(deathCrateHistory(list, 2).map(c => [c.id, c.firstSeen, c.lastSeen])).toEqual([['a', 1, 1], ['b', 1, 2], ['c', 2, 2]]);
  });
});

describe('creatures', () => {
  it('builds creatures.json from the extractor spawners, sorted, rounded, broken entries left out', () => {
    const f = buildCreatures({ creatureSpawners: [
      { name: 'B', creature: 'Char_Hog_C', location: [1.4, 2.6, -3] },
      { name: 'A', creature: 'Char_Stinger_C', location: [0, 0, 0] },
      { name: 'C', creature: 'Char_Hog_C', location: [1] },
    ] }, '1.2.5.0');
    expect(f).toEqual({ version: '1.2.5.0', spawners: [['A', 'Char_Stinger_C', 0, 0, 0], ['B', 'Char_Hog_C', 1, 3, -3]] });
  });
  it('sorts creatures into families', () => {
    expect(['Char_NuclearHog_C', 'Char_SpitterAquaticAlpha_C', 'Char_EliteStinger_C', 'Char_BigCrabHatcher_C', 'Char_SpaceGiraffe_C'].map(creatureFamily))
      .toEqual(['hog', 'spitter', 'stinger', 'hatcher', 'wildlife']);
  });
  it('indexes kills by spawner name', () => {
    expect(killsByName([['A', 3, 1, 80]]).get('A')).toEqual({ kills: 3, dead: 1, lastDay: 80 });
    expect(killsByName([['A', 3, 1]]).get('A')).toEqual({ kills: 3, dead: 1 });
    expect(killsByName(undefined).size).toBe(0);
  });
  it('sorts a spawner into one kill state; sums kills, spawners and dead creatures in one place', () => {
    expect([undefined, { kills: 0, dead: 0 }, { kills: 2, dead: 1 }, { kills: 2, dead: 0 }].map(killState)).toEqual(['untouched', 'untouched', 'dead', 'back']);
    const k = killsByName([['A', 3, 1], ['B', 1, 0]]);
    expect(killSummary(k, 6)).toEqual({ kills: 4, spawners: 2, dead: 1, total: 6, withoutSpawner: 2 });
    expect(killSummary(k, null).withoutSpawner).toBe(0);
  });
  it('counts per biome the spawners whose creatures live (not dead right now), most first; outside every biome is -1', () => {
    const spawners = readCreatures({ version: 't', spawners: [
      ['A', 'Char_Hog_C', 0, 0, 0], ['B', 'Char_Hog_C', 10, 0, 0], ['C', 'Char_Stinger_C', 20, 0, 0],
      ['D', 'Char_Spitter_C', 100, 0, 0], ['E', 'Char_Spitter_C', 110, 0, 0], ['F', 'Char_Hog_C', 999, 0, 0],
    ] });
    // A and D dead now, B killed before and back, the rest never killed.
    const kills = killsByName([['A', 2, 1], ['B', 1, 0], ['D', 1, 1]]);
    const biomeOf = (x: number) => (x < 50 ? 0 : x < 500 ? 1 : -1);
    expect(creaturesByBiome(spawners, kills, biomeOf)).toEqual([
      { biome: 0, open: 2, total: 3 },
      { biome: 1, open: 1, total: 2 },
      { biome: -1, open: 1, total: 1 },
    ]);
    // A cleared biome stays in the list with 0 open, after the others.
    const cleared = killsByName([['A', 1, 1], ['B', 1, 1], ['C', 1, 1]]);
    expect(creaturesByBiome(spawners.slice(0, 4), cleared, biomeOf)).toEqual([
      { biome: 1, open: 1, total: 1 },
      { biome: 0, open: 0, total: 3 },
    ]);
  });
});
