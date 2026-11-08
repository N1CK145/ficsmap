import {
  extractionRate, extractorsForNode, gameExtractorFor, nodeRates, placedRate, pressurizerClock, purityRates,
} from '../../src/shared/nodeRates.js';
import { indexRecipes } from '../../src/shared/recipes.js';
import type { ExtractorInfo, ResourceNode } from '../../src/shared/resourceNodes.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';

const index = indexRecipes(RECIPE_DATA);
const node = (o: Partial<ResourceNode> = {}): ResourceNode => ({ name: 'N', kind: 'node', resource: 'ore', purity: 'normal', x: 0, y: 0, z: 0, ...o });
const ids = (list: { extractor: { id: string } }[] | { id: string }[]) => list.map(e => ('extractor' in e ? e.extractor.id : e.id));

describe('extractionRate', () => {
  it('scales the 100 % rate by the purity factor and the clock speed', () => {
    expect(extractionRate(60, 'impure')).toBe(30);
    expect(extractionRate(60, 'normal')).toBe(60);
    expect(extractionRate(60, 'pure')).toBe(120);
    expect(extractionRate(120, 'pure', 1.5)).toBe(360);
    expect(extractionRate(240, 'pure', 2.5)).toBe(1200);
  });
});

describe('extractorsForNode', () => {
  it('miners by tier on a solid node, the oil extractor on an oil node, the well extractor on a satellite', () => {
    expect(ids(extractorsForNode(node(), index))).toEqual(['mk1', 'mk2']);
    expect(ids(extractorsForNode(node({ resource: 'oil' }), index))).toEqual(['oilpump']);
    expect(ids(extractorsForNode(node({ kind: 'satellite', resource: 'oil' }), index))).toEqual(['well']);
    expect(ids(extractorsForNode(node({ kind: 'satellite', resource: 'water' }), index))).toEqual(['well']);
  });

  it('none for cores, geysers, resources nothing extracts, and not the water extractor (not built on nodes)', () => {
    expect(extractorsForNode(node({ kind: 'core', resource: 'oil', purity: null }), index)).toEqual([]);
    expect(extractorsForNode(node({ kind: 'geyser', resource: 'Geyser' }), index)).toEqual([]);
    expect(extractorsForNode(node({ resource: 'Desc_Unknown_C' }), index)).toEqual([]);
    expect(extractorsForNode(node({ resource: 'water' }), index)).toEqual([]);
  });
});

describe('nodeRates', () => {
  it('gives each fitting extractor its rate at the node purity and 100 %', () => {
    expect(nodeRates(node({ purity: 'pure' }), index).map(r => [r.extractor.id, r.rate])).toEqual([['mk1', 120], ['mk2', 240]]);
    expect(nodeRates(node({ purity: 'impure', resource: 'oil' }), index).map(r => [r.extractor.id, r.rate])).toEqual([['oilpump', 60]]);
    expect(nodeRates(node({ kind: 'satellite', resource: 'gas', purity: 'pure' }), index).map(r => r.rate)).toEqual([120]);
  });

  it('is empty without a purity', () => {
    expect(nodeRates(node({ purity: null }), index)).toEqual([]);
  });
});

describe('placedRate', () => {
  const at = (kind: ExtractorInfo['kind'], clock: number | null): ExtractorInfo => ({ kind, clock, shards: null });

  it('maps the save\'s building to the recipe data and applies purity and clock speed', () => {
    expect(gameExtractorFor('miner2', extractorsForNode(node(), index))?.id).toBe('mk2');
    expect(gameExtractorFor('miner3', extractorsForNode(node(), index))).toBeUndefined();
    expect(placedRate(node({ purity: 'pure' }), at('miner2', 1.5), index)).toMatchObject({ clock: 1.5, rate: 360 });
    expect(placedRate(node({ resource: 'oil', purity: 'impure' }), at('oil', 2), index)).toMatchObject({ clock: 2, rate: 120 });
  });

  it('runs a well extractor at its pressurizer\'s clock speed, and not without one', () => {
    const sat = node({ kind: 'satellite', resource: 'oil', purity: 'normal', core: 'C' });
    expect(placedRate(sat, at('well', null), index, 2)).toMatchObject({ clock: 2, rate: 120 });
    expect(placedRate(sat, at('well', null), index, null)).toBeNull();
  });

  it('has no rate for extractors the recipe data lacks or that make no items', () => {
    expect(placedRate(node(), at('portable', null), index)).toBeNull();
    expect(placedRate(node({ kind: 'geyser', resource: 'Geyser' }), at('geothermal', null), index)).toBeNull();
    expect(placedRate(node({ kind: 'core', resource: 'oil', purity: null }), at('pressurizer', 1), index)).toBeNull();
    expect(placedRate(node({ resource: 'oil' }), at('miner1', 1), index)).toBeNull();
  });
});

describe('pressurizerClock', () => {
  it('reads the clock speed of the pressurizer on the satellite\'s core', () => {
    const byNode = new Map<string, ExtractorInfo[]>([['C', [{ kind: 'pressurizer', clock: 1.75, shards: 2 }]], ['D', []]]);
    expect(pressurizerClock({ core: 'C' }, byNode)).toBe(1.75);
    expect(pressurizerClock({ core: 'D' }, byNode)).toBeNull();
    expect(pressurizerClock({}, byNode)).toBeNull();
  });
});

describe('purityRates', () => {
  it('lists the extractors built on nodes (miners by tier, oil extractor, well extractor) at the purity', () => {
    expect(purityRates('impure', index).map(r => [r.extractor.id, r.rate])).toEqual([['mk1', 30], ['mk2', 60], ['oilpump', 60], ['well', 30]]);
  });
});
