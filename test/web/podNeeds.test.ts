import type { Item } from '../../src/shared/dataset.js';
import { podNeeds } from '../../src/web/features/routes/podNeeds.js';

const pod = (name: string, req?: { item?: string; amount?: number; power?: number }): Item => ({
  name, type: 'hard_drive', x: 0, y: 0, z: 0, biome: 0, seq: 1,
  ...(req ? { extra: { pod: { item: req.item ? { en: req.item, de: req.item } : null, amount: req.amount ?? 0, power: req.power ?? 0 } } } : {}),
});
const sloop: Item = { name: 'S', type: 'somersloop', x: 0, y: 0, z: 0, biome: 0, seq: 1 };

describe('podNeeds', () => {
  it('sums items per kind (most first), counts power pods with the highest MW, and pods needing nothing', () => {
    const n = podNeeds([
      pod('a', { item: 'Rotor', amount: 4 }), pod('b', { item: 'Copper Sheet', amount: 10 }), pod('c', { item: 'Rotor', amount: 21 }),
      pod('d', { power: 100 }), pod('e', { power: 300 }), pod('f', {}), sloop,
    ], () => false, 'en');
    expect(n).toEqual({ pods: 6, items: [{ item: 'Rotor', amount: 25 }, { item: 'Copper Sheet', amount: 10 }], power: { pods: 2, maxMw: 300 }, free: 1, unknown: 0 });
  });

  it('leaves out checked pods and counts pods without data as unknown', () => {
    const n = podNeeds([pod('a', { item: 'Rotor', amount: 4 }), pod('b', { power: 50 }), pod('c')], name => name === 'a', 'en');
    expect(n).toEqual({ pods: 2, items: [], power: { pods: 1, maxMw: 50 }, free: 0, unknown: 1 });
  });

  it('is null without open pods', () => {
    expect(podNeeds([sloop, pod('a', { power: 1 })], name => name === 'a', 'en')).toBeNull();
  });
});
