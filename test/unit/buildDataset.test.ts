import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildCrashSites, buildDataset, BuildError, loadExtractorDir, type BuildInput } from '../../scripts/build-dataset.js';

const dir = fileURLToPath(new URL('../fixtures/extractor-mini', import.meta.url));
const base = (): BuildInput => structuredClone(loadExtractorDir(dir));
type Coll = { pickups: { name: string; class: string; location: number[] }[]; dropPods: { name: string }[] };
type Extras = { dropPods: Record<string, unknown>; shrines: { name: string; attachedTo: string; location: number[] }[] };

function fails(input: BuildInput, re: RegExp) {
  try { buildDataset(input); } catch (e) {
    expect(e).toBeInstanceOf(BuildError);
    expect((e as BuildError).problems.join('\n')).toMatch(re);
    return;
  }
  throw new Error('expected BuildError');
}

describe('buildDataset (mini fixture)', () => {
  const ds = buildDataset(base());
  const by = (n: string) => ds.items.find(i => i[0] === n)!;

  it('header', () => {
    expect(ds.version).toBe('1.0.0.0');
    expect(ds.mapId).toBe('minimap0000000001');
    expect(ds.bounds).toEqual({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 });
    expect(ds.podRequirementsKnown).toBe(true);
    expect(ds.biomes).toEqual([
      { id: 'west-plains', name: { en: 'West Plains', de: 'West Plains' } },
      { id: 'east-dunes', name: { en: 'East Dunes', de: 'East Dunes' } },
    ]);
  });
  it('filters untracked pickups and derives types from classes', () => {
    expect(ds.items).toHaveLength(8);
    expect(ds.items.find(i => i[0] === 'BP_BerryBush1')).toBeUndefined();
    expect(by('BP_Crystal_C_1')[1]).toBe('slug_blue');
    expect(by('BP_Crystal_mk3_C_1')[1]).toBe('slug_purple');
    expect(by('BP_WAT1_C_1')[1]).toBe('somersloop');
    expect(by('BP_DropPod1')[1]).toBe('hard_drive');
  });
  it('assigns biome indices', () => {
    expect(by('BP_Crystal_C_1')[5]).toBe(0);
    expect(by('BP_WAT2_C_UAID_A')[5]).toBe(1);
    expect(by('BP_DropPod2_1')[5]).toBe(1);
  });
  it('numbers seq per biome by type order then x', () => {
    expect(by('BP_Crystal_C_1')[6]).toBe(1);
    expect(by('BP_Crystal_C_2')[6]).toBe(2);
    expect(by('BP_WAT1_C_1')[6]).toBe(3);
    expect(by('BP_DropPod1')[6]).toBe(4);
    expect(by('BP_Crystal_mk2_C_1')[6]).toBe(1);
  });
  it('maps the shrine to its sphere', () => {
    expect(ds.aliases).toEqual({ BP_MercerShrine_C_UAID_S: 'BP_WAT2_C_UAID_A' });
  });
  it('adds shards to slugs and pod requirements to pods', () => {
    expect(by('BP_Crystal_C_1')[7]).toEqual({ shards: 1 });
    expect(by('BP_Crystal_mk3_C_1')[7]).toEqual({ shards: 5 });
    expect(by('BP_DropPod1')[7]).toEqual({ pod: { item: { en: 'Rotor', de: 'Rotor' }, amount: 3, power: 0 } });
    expect(by('BP_DropPod2_1')[7]).toEqual({ pod: { item: null, amount: 0, power: 30 } });
    expect(by('BP_WAT1_C_1')[7]).toBeUndefined();
  });
  it('pod cost semantics: None keeps what is set, null cost is omitted', () => {
    const i = base();
    const e = i.extras as Extras;
    e.dropPods.BP_DropPod1 = { costType: 'None', item: 'Desc_Rotor_C', amount: 2, power: 0 };
    e.dropPods.BP_DropPod2_1 = { costType: null, item: null, amount: 0, power: 0 };
    const d = buildDataset(i);
    expect(d.items.find(x => x[0] === 'BP_DropPod1')![7]).toEqual({ pod: { item: { en: 'Rotor', de: 'Rotor' }, amount: 2, power: 0 } });
    expect(d.items.find(x => x[0] === 'BP_DropPod2_1')![7]).toBeUndefined();
  });
});

describe('buildDataset failures', () => {
  it('duplicate names', () => {
    const i = base(); const c = i.collectibles as Coll;
    c.pickups.push({ ...c.pickups[1]! });
    fails(i, /duplicate item name BP_Crystal_C_2/i);
  });
  it('type with count 0', () => {
    const i = base(); const c = i.collectibles as Coll;
    c.pickups = c.pickups.filter(p => p.class !== 'BP_Crystal_mk3_C');
    fails(i, /slug_purple has 0/);
  });
  it('item outside every biome beyond the snap distance', () => {
    const i = base(); const c = i.collectibles as Coll;
    c.pickups[1]!.location = [500000, 30000, 0];
    fails(i, /BP_Crystal_C_2.*outside/i);
  });
  it('sphere with two shrines', () => {
    const i = base(); const e = i.extras as Extras;
    e.shrines.push({ ...e.shrines[0]!, name: 'BP_MercerShrine_C_UAID_T' });
    fails(i, /BP_WAT2_C_UAID_A has 2 shrines/);
  });
  it('shrine attached to an unknown sphere', () => {
    const i = base(); const e = i.extras as Extras;
    e.shrines[0]!.attachedTo = 'BP_WAT2_C_nope';
    fails(i, /BP_MercerShrine_C_UAID_S.*BP_WAT2_C_nope/);
  });
  it('sphere without shrine while shrines exist', () => {
    const i = base(); const c = i.collectibles as Coll;
    c.pickups.push({ name: 'BP_WAT2_C_UAID_B', class: 'BP_WAT2_C', location: [80000, 70000, 0] });
    fails(i, /BP_WAT2_C_UAID_B has no shrine/);
  });
  it('spheres without shrines are fine when there are no shrines at all', () => {
    const i = base(); (i.extras as Extras).shrines = [];
    expect(buildDataset(i).aliases).toEqual({});
  });
  it('pod item missing from item names', () => {
    const i = base(); i.itemNames = {};
    fails(i, /Desc_Rotor_C/);
  });
});

describe('crash-site data', () => {
  const site = (requirement: unknown, extra: object = {}) => ({
    region: 'R', guideSite: 1, requirement, threats: [{ name: 'Hatcher', count: 2 }, { name: 'Gas Pillar', count: null }],
    items: [
      { item: 'Steel Pipe', itemClass: 'Desc_SteelPipe_C', amount: 98, pickup: 'P1', where: 'lower level' },
      { item: 'Rotor', amount: 5, inGame: false },
      { item: 'Stator', itemClass: 'Desc_Stator_C', amount: 37, pickup: 'P2', inGuide: false, distanceM: 40 },
    ],
    ...extra,
  });

  it('fills an unknown pod requirement from the guide when it says nothing is needed', () => {
    const input = base();
    (input.extras as Extras).dropPods.BP_DropPod2_1 = { costType: null, item: null, amount: 0, power: 0 };
    input.crashSites = { pods: { BP_DropPod2_1: site({ type: 'none' }), BP_DropPod1: site({ type: 'none' }) } };
    const d = buildDataset(input);
    expect(d.items.find(x => x[0] === 'BP_DropPod2_1')![7]).toEqual({ pod: { item: null, amount: 0, power: 0 } });
    // The game's own requirement wins over the guide.
    expect(d.items.find(x => x[0] === 'BP_DropPod1')![7]).toEqual({ pod: { item: { en: 'Rotor', de: 'Rotor' }, amount: 3, power: 0 } });
  });

  it('keeps an unknown requirement unknown when the guide names one', () => {
    const input = base();
    (input.extras as Extras).dropPods.BP_DropPod2_1 = { costType: null, item: null, amount: 0, power: 0 };
    input.crashSites = { pods: { BP_DropPod2_1: site({ type: 'power', mw: 50 }) } };
    expect(buildDataset(input).items.find(x => x[0] === 'BP_DropPod2_1')![7]).toBeUndefined();
  });

  it('writes the in-game items, threats and notes per pod of the dataset', () => {
    const d = buildDataset(base());
    const out = buildCrashSites({ pods: { BP_DropPod1: site({ type: 'none' }, { notes: ['Bring a gas mask.'] }), BP_Unknown: site({ type: 'none' }) } }, d);
    expect(Object.keys(out)).toEqual(['BP_DropPod1']);
    expect(out.BP_DropPod1).toEqual({
      items: [{ item: 'Steel Pipe', amount: 98, where: 'lower level' }, { item: 'Stator', amount: 37 }],
      threats: [{ name: 'Hatcher', count: 2 }, { name: 'Gas Pillar', count: null }],
      notes: ['Bring a gas mask.'],
    });
  });
});
