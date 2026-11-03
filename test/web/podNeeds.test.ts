import type { CrashSites, Item } from '../../src/shared/dataset.js';
import { podNeeds } from '../../src/web/features/routes/podNeeds.js';

const pod = (name: string, req?: { item?: string; amount?: number; power?: number }): Item => ({
  name, type: 'hard_drive', x: 0, y: 0, z: 0, biome: 0, seq: 1,
  ...(req ? { extra: { pod: { item: req.item ? { en: req.item, de: `${req.item} (de)` } : null, amount: req.amount ?? 0, power: req.power ?? 0 } } } : {}),
});
const sloop: Item = { name: 'S', type: 'somersloop', x: 0, y: 0, z: 0, biome: 0, seq: 1 };
const site = (...items: [string, number][]): CrashSites[string] => ({ items: items.map(([item, amount]) => ({ item, amount })), threats: [], notes: [] });

describe('podNeeds', () => {
  it('sums items per kind (most first), counts power pods with the highest MW, and pods needing nothing', () => {
    const n = podNeeds([
      pod('a', { item: 'Rotor', amount: 4 }), pod('b', { item: 'Copper Sheet', amount: 10 }), pod('c', { item: 'Rotor', amount: 21 }),
      pod('d', { power: 100 }), pod('e', { power: 300 }), pod('f', {}), sloop,
    ], () => false, 'en', {});
    expect(n).toEqual({
      pods: 6,
      items: [
        { key: 'Rotor', item: 'Rotor', need: 25, bring: 25, onRoute: [] },
        { key: 'Copper Sheet', item: 'Copper Sheet', need: 10, bring: 10, onRoute: [] },
      ],
      power: { pods: 2, maxMw: 300 }, free: 1, unknown: 0,
    });
  });

  it('leaves out checked pods and counts pods without data as unknown', () => {
    const n = podNeeds([pod('a', { item: 'Rotor', amount: 4 }), pod('b', { power: 50 }), pod('c')], name => name === 'a', 'en', {});
    expect(n).toEqual({ pods: 2, items: [], power: { pods: 1, maxMw: 50 }, free: 0, unknown: 1 });
  });

  it('is null without open pods', () => {
    expect(podNeeds([sloop, pod('a', { power: 1 })], name => name === 'a', 'en', {})).toBeNull();
  });

  it('names items in the locale but matches loot by the English name', () => {
    const n = podNeeds([pod('a', { item: 'Rotor', amount: 4 })], () => false, 'de', { a: site(['Rotor', 1]) });
    expect(n?.items).toEqual([{ key: 'Rotor', item: 'Rotor (de)', need: 4, bring: 3, onRoute: [{ stop: 1, amount: 1 }] }]);
  });

  it('covers a need from loot at the pod\'s own crash site', () => {
    const n = podNeeds([sloop, pod('a', { item: 'Rotor', amount: 4 })], () => false, 'en', { a: site(['Rotor', 10]) });
    expect(n?.items).toEqual([{ key: 'Rotor', item: 'Rotor', need: 4, bring: 0, onRoute: [{ stop: 2, amount: 4 }] }]);
  });

  it('covers a need from loot at an earlier stop, but not from a later one', () => {
    const n = podNeeds(
      [pod('a', {}), pod('b', { item: 'Rotor', amount: 10 }), pod('c', {})],
      () => false, 'en', { a: site(['Rotor', 6]), c: site(['Rotor', 50]) },
    );
    expect(n?.items).toEqual([{ key: 'Rotor', item: 'Rotor', need: 10, bring: 4, onRoute: [{ stop: 1, amount: 6 }] }]);
  });

  it('uses loot oldest first and only once across pods', () => {
    const n = podNeeds(
      [pod('a', {}), pod('b', { item: 'Rotor', amount: 8 }), pod('c', { item: 'Rotor', amount: 8 })],
      () => false, 'en', { a: site(['Rotor', 10]), c: site(['Rotor', 3]) },
    );
    // b takes 8 of a's 10; c gets a's other 2, then 3 at its own site, and brings 3.
    expect(n?.items).toEqual([{ key: 'Rotor', item: 'Rotor', need: 16, bring: 3, onRoute: [{ stop: 1, amount: 10 }, { stop: 3, amount: 3 }] }]);
  });

  it('adds up loot of one kind listed twice at a site', () => {
    const n = podNeeds([pod('a', { item: 'Rotor', amount: 10 })], () => false, 'en', { a: site(['Rotor', 4], ['Rotor', 5]) });
    expect(n?.items[0]).toMatchObject({ bring: 1, onRoute: [{ stop: 1, amount: 9 }] });
  });

  it('ignores loot at checked pods\' sites', () => {
    const n = podNeeds(
      [pod('a', {}), pod('b', { item: 'Rotor', amount: 5 })],
      name => name === 'a', 'en', { a: site(['Rotor', 10]) },
    );
    expect(n?.items[0]).toMatchObject({ bring: 5, onRoute: [] });
  });

  it('lists what still has to be brought first (most first), then what is fully found on the way', () => {
    const n = podNeeds(
      [pod('a', { item: 'Rotor', amount: 50 }), pod('b', { item: 'Motor', amount: 2 }), pod('c', { item: 'Wire', amount: 5 })],
      () => false, 'en', { a: site(['Rotor', 50]), b: site(['Motor', 1]) },
    );
    expect(n?.items.map(i => [i.key, i.bring])).toEqual([['Wire', 5], ['Motor', 1], ['Rotor', 0]]);
  });
});
