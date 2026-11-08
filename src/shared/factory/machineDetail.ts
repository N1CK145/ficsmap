import type { ItemAmount } from '../recipes.js';
import type { AnalysisData, ItemRate, MachineFlow } from './analysis.js';

/*
 * What the factory's machine window shows beyond a machine's flow (`MachineFlow`), from the same game data the analysis
 * reads: the recipe's inputs at the machine's clock speed, the length of one cycle, the power it draws while running,
 * the fuels a generator burns and its Somersloop slots. Pure; per minute, fluids in m³, power in MW.
 */

/** One fuel a generator can burn, per minute at the generator's clock speed. */
export interface FuelRate {
  item: string;
  /** Fuel per minute; absent when the game data does not say. */
  perMinute?: number;
  /** What it needs besides (water), per minute. */
  supplement?: ItemAmount;
}

export interface MachineDetail {
  /**
   * Manufacturers: the recipe's ingredients per minute at its clock speed (`nominal`) and as it ran (`actual` =
   * nominal × productivity, as the analysis reckons its outputs). Somersloops boost the output only, not the inputs.
   */
  inputs: ItemRate[];
  /** Seconds per production cycle: the recipe's duration over the clock speed (manufacturers only). */
  cycleSeconds?: number;
  /**
   * MW it draws while it runs, at its clock speed (`power × clock^exponent`; Somersloops multiply it by the square of
   * their output boost); a range for recipes with variable power. Absent for generators and machines the data does
   * not know, or when it is 0.
   */
  powerUse?: { min: number; max: number };
  /** Generators: the fuels it burns (one of them at a time) at its clock speed; empty for anything else. */
  fuels: FuelRate[];
  /** Somersloop slots of the building (0 when it has none or the machine data is missing). */
  sloopSlots: number;
}

const WELL_KIND = 'well';

export function machineDetail(m: MachineFlow, data: AnalysisData): MachineDetail {
  const entry = data.machines?.get(m.cls);
  const out: MachineDetail = { inputs: [], fuels: [], sloopSlots: entry?.stats.somersloopSlots ?? 0 };
  const recipe = m.recipe ? data.recipes.recipes.get(m.recipe) : undefined;
  if (m.kind === 'manufacturer' && recipe) {
    const perCycle = (60 / recipe.duration) * m.clock;
    out.inputs = recipe.ingredients.map(i => {
      const nominal = i.amount * perCycle;
      const actual = nominal * m.productivity;
      return { item: i.item, nominal, actual, lost: nominal - actual };
    });
    out.cycleSeconds = recipe.duration / m.clock;
    const machine = data.recipes.machines.get(recipe.machine);
    const base = recipe.power ?? (machine ? { min: machine.power, max: machine.power } : undefined);
    if (base) {
      const f = m.clock ** (machine?.powerExponent ?? 1) * m.boost ** 2;
      out.powerUse = { min: base.min * f, max: base.max * f };
    }
  } else if (m.kind === 'extractor') {
    const ex = data.recipes.extractors.get(m.cls);
    // A resource well's extractors run at 100 %: the clock speed is the pressurizer's.
    if (ex) {
      const mw = ex.power * (ex.kind === WELL_KIND ? 1 : m.clock ** ex.powerExponent);
      out.powerUse = { min: mw, max: mw };
    }
  } else if (m.kind === 'generator') {
    out.fuels = (entry?.stats.fuels ?? []).map(f => {
      const fuel: FuelRate = { item: f.item };
      if (f.perMinute !== undefined) fuel.perMinute = f.perMinute * m.clock;
      if (f.supplement) fuel.supplement = { item: f.supplement.item, amount: f.supplement.amount * m.clock };
      return fuel;
    });
  }
  if (out.powerUse && out.powerUse.max <= 0) delete out.powerUse;
  return out;
}
