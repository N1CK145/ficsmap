import { machineFlow, type AnalysisData } from '../../src/shared/factory/analysis.js';
import { machineDetail } from '../../src/shared/factory/machineDetail.js';
import type { SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { MachineEntry } from '../../src/shared/machines.js';
import { indexRecipes } from '../../src/shared/recipes.js';

const n = (en: string) => ({ en, de: en });
const DATA: AnalysisData = {
  recipes: indexRecipes({
    format: 1, source: 't', clock: { min: 0.01, perShard: 0.5 },
    items: [{ id: 'ore', name: n('Ore'), form: 'solid' }, { id: 'ingot', name: n('Ingot'), form: 'solid' }, { id: 'coal', name: n('Coal'), form: 'solid' }],
    recipes: [{ id: 'R', name: n('Ingot'), alternate: false, machine: 'Smelter', duration: 2, ingredients: [{ item: 'ore', amount: 1 }], products: [{ item: 'ingot', amount: 1 }] }],
    machines: [{ id: 'Smelter', name: n('Smelter'), power: 4, powerExponent: 2 }],
    extractors: [
      { id: 'Miner', name: n('Miner'), kind: 'miner', rate: 60, power: 5, powerExponent: 2, resources: ['ore'], onNode: true },
      { id: 'Well', name: n('Well'), kind: 'well', rate: 60, power: 0, powerExponent: 1, resources: ['ore'], onNode: true },
    ],
  }),
  machines: new Map<string, MachineEntry>([
    ['Smelter', { id: 'Smelter', category: 'production', name: n('Smelter'), description: n(''), wikiPage: '', stats: { somersloopSlots: 2 }, unlockedBy: [] }],
    ['Gen', { id: 'Gen', category: 'power', name: n('Gen'), description: n(''), wikiPage: '', unlockedBy: [],
      stats: { powerProduction: 75, fuels: [{ item: 'coal', perMinute: 15, supplement: { item: 'water', amount: 45 } }, { item: 'x' }] } }],
  ]),
};
const b = (cls: string, prod: SnapshotBuilding['prod']): SnapshotBuilding => ({ id: cls, cls, x: 0, y: 0, z: 0, yaw: 0, prod });

describe('machine detail', () => {
  it('gives a manufacturer its inputs at its clock speed, actual by productivity, its cycle and power', () => {
    const d = machineDetail(machineFlow(b('Smelter', { clock: 2, recipe: 'R', productivity: 0.5 }), DATA), DATA);
    expect(d.inputs).toEqual([{ item: 'ore', nominal: 60, actual: 30, lost: 30 }]);
    expect(d.cycleSeconds).toBe(1);
    // 4 MW × 2²
    expect(d.powerUse).toEqual({ min: 16, max: 16 });
    expect(d.sloopSlots).toBe(2);
    expect(d.fuels).toEqual([]);
  });

  it('multiplies the power by the square of the Somersloop boost; the inputs stay', () => {
    const d = machineDetail(machineFlow(b('Smelter', { clock: 1, recipe: 'R', productivity: 1, somersloops: 2 }), DATA), DATA);
    expect(d.inputs[0]!.nominal).toBe(30);
    expect(d.powerUse).toEqual({ min: 16, max: 16 });
  });

  it('gives extractors their power (a well none) and generators their fuels at the clock speed', () => {
    expect(machineDetail(machineFlow(b('Miner', { clock: 2, productivity: 1 }), DATA), DATA).powerUse).toEqual({ min: 20, max: 20 });
    expect(machineDetail(machineFlow(b('Well', { clock: 2, productivity: 1 }), DATA), DATA).powerUse).toBeUndefined();
    const gen = machineDetail(machineFlow(b('Gen', { clock: 0.5, productivity: 1 }), DATA), DATA);
    expect(gen.fuels).toEqual([{ item: 'coal', perMinute: 7.5, supplement: { item: 'water', amount: 22.5 } }, { item: 'x' }]);
    expect(gen.powerUse).toBeUndefined();
  });
});
