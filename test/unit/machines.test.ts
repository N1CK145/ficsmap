import { groupByCategory, matchesQuery, perMinute, statRows, wikiTitle, wikiUrl, type MachineEntry, type WikiItem } from '../../src/shared/machines.js';

const entry = (over: Partial<MachineEntry>): MachineEntry => ({
  id: 'Build_X_C', category: 'production', name: { en: 'X', de: 'X' }, description: { en: '', de: '' },
  wikiPage: 'X', stats: {}, unlockedBy: [], ...over,
});

const ITEMS: Record<string, WikiItem> = {
  Desc_LiquidOil_C: { name: { en: 'Crude Oil', de: 'Rohöl' }, form: 'liquid' },
  Desc_NitrogenGas_C: { name: { en: 'Nitrogen Gas', de: 'Stickstoff' }, form: 'gas' },
};

describe('machine wiki helpers', () => {
  it('derives the wiki page title and URL from the English name', () => {
    expect(wikiTitle('Coal-Powered Generator')).toBe('Coal-Powered_Generator');
    expect(wikiTitle('Factory Cart™')).toBe('Factory_Cart');
    expect(wikiTitle('Miner Mk.1')).toBe('Miner_Mk.1');
    expect(wikiUrl('Coal-Powered_Generator')).toBe('https://satisfactory.wiki.gg/wiki/Coal-Powered_Generator');
    expect(wikiUrl('AWESOME_Sink')).toBe('https://satisfactory.wiki.gg/wiki/AWESOME_Sink');
  });

  it('computes per-minute amounts without float noise', () => {
    expect(perMinute(2, 6)).toBe(20);
    expect(perMinute(1, 8.4)).toBe(7.142857);
    expect(perMinute(0.1 + 0.2, 60)).toBe(0.3);
  });

  it('matches English and German names, every word, ignoring case and accents', () => {
    const smelter = entry({ name: { en: 'Smelter', de: 'Schmelzofen' } });
    const fuel = entry({ name: { en: 'Fuel-Powered Generator', de: 'Treibstoffgenerator' } });
    expect(matchesQuery(smelter, '')).toBe(true);
    expect(matchesQuery(smelter, 'SMELT')).toBe(true);
    expect(matchesQuery(smelter, 'schmelz')).toBe(true);
    expect(matchesQuery(fuel, 'powered gen')).toBe(true);
    expect(matchesQuery(fuel, 'powered coal')).toBe(false);
    expect(matchesQuery(entry({ name: { en: 'Foundry', de: 'Gießerei' } }), 'giesserei')).toBe(false);
    expect(matchesQuery(entry({ name: { en: 'Resume', de: 'Résumé' } }), 'resume')).toBe(true);
  });

  it('groups by category in a fixed order, leaving out empty ones', () => {
    const groups = groupByCategory([
      entry({ id: 'v', category: 'vehicles' }), entry({ id: 'p', category: 'production' }), entry({ id: 'p2', category: 'production' }),
    ]);
    expect(groups.map(g => [g.category, g.entries.map(e => e.id)])).toEqual([['production', ['p', 'p2']], ['vehicles', ['v']]]);
  });

  it('lists the stats in a fixed order and only what the entry has', () => {
    const constructor = entry({ stats: { somersloopSlots: 1, powerExponent: 1.321929, clock: { min: 0.01, max: 1 }, powerUse: 4 } });
    expect(statRows(constructor, ITEMS, 'en')).toEqual([
      { id: 'powerUse', params: { mw: 4 } },
      { id: 'clock', params: { min: 0.01, max: 1 } },
      { id: 'powerExponent', params: { exponent: 1.321929 } },
      { id: 'somersloopSlots', params: { slots: 1 } },
    ]);
    expect(statRows(entry({}), ITEMS, 'en')).toEqual([]);
  });

  it('names resources in the language asked for, and marks a fluid tank as not in the data', () => {
    const well = entry({ stats: { extractionPerMinute: 60, extractionFluid: true, extractionNode: true, resources: ['Desc_LiquidOil_C', 'Desc_NitrogenGas_C', 'Desc_Unknown_C'] } });
    expect(statRows(well, ITEMS, 'de')).toEqual([
      { id: 'extractionFluid', params: { rate: 60, node: 'yes' } },
      { id: 'resources', params: { names: 'Rohöl, Stickstoff, Desc_Unknown_C' } },
    ]);
    const miner = entry({ stats: { extractionPerMinute: 60, extractionFluid: false, extractionNode: true, resourceForms: ['solid'] } });
    expect(statRows(miner, ITEMS, 'en')).toEqual([{ id: 'extraction', params: { rate: 60, node: 'yes' } }, { id: 'resourceForm', params: { form: 'solid' } }]);
    const water = entry({ stats: { extractionPerMinute: 120, extractionFluid: true, extractionNode: false } });
    expect(statRows(water, ITEMS, 'en')).toEqual([{ id: 'extractionFluid', params: { rate: 120, node: 'no' } }]);
    const truck = entry({ category: 'vehicles', stats: { fuelBurn: 75, fluidStorage: true } });
    expect(statRows(truck, ITEMS, 'en')).toEqual([{ id: 'fuelBurn', params: { mw: 75 } }, { id: 'fluidStorage', params: {} }]);
  });

  it('shows the geothermal average with its cycle, and storage size apart from inventory', () => {
    const geo = entry({ category: 'power', stats: { powerVariable: { average: 200, cycleSeconds: 60 } } });
    expect(statRows(geo, ITEMS, 'en')).toEqual([{ id: 'powerVariable', params: { mw: 200, seconds: 60 } }]);
    const port = entry({ category: 'logistics', stats: { powerUse: 100, storageSlots: 18, fuelSlots: 1 } });
    expect(statRows(port, ITEMS, 'en').map(r => r.id)).toEqual(['powerUse', 'storageSlots', 'fuelSlots']);
  });
});
