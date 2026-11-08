import type { FactoryDiff } from '../../src/shared/factory/analysis.js';
import type { LineGroup, ProductionLine } from '../../src/shared/factory/lines.js';
import { diffRowOf, diffSummary } from '../../src/web/features/factory/changes.js';
import type { FactoryLabels } from '../../src/web/features/factory/data.js';
import { bottleneckText, capacityText, edgeRateText, groupTitle, lineName, nextTier } from '../../src/web/features/factory/lineInfo.js';
import * as mapView from '../../src/web/features/factory/map/lineView.js';

const NAMES: Record<string, string> = {
  Build_SmelterMk1_C: 'Smelter', Build_ConstructorMk1_C: 'Constructor', Build_MinerMk2_C: 'Miner Mk.2', Build_MinerMk3_C: 'Miner Mk.3',
  Build_ConveyorBeltMk1_C: 'Conveyor Belt Mk.1', Build_ConveyorBeltMk2_C: 'Conveyor Belt Mk.2', Build_GeneratorBiomass_C: 'Biomass Burner',
  Build_ConveyorAttachmentMerger_C: 'Conveyor Merger',
};
const LABELS: FactoryLabels = {
  building: cls => NAMES[cls] ?? cls,
  buildingPicture: cls => cls,
  category: cls => (cls.startsWith('Build_Conveyor') ? 'logistics-belt' : cls.startsWith('Build_Foundation') ? 'structure' : cls.startsWith('Build_Sign') ? 'sign' : 'production'),
  item: cls => cls.replace(/^Desc_|_C$/g, ''),
  isFluid: cls => cls === 'Desc_Water_C',
};
/** Keys with their values, so the sentences can be checked without the message catalogue. */
const t = (k: string, o?: Record<string, unknown>) => `${k}${o ? JSON.stringify(o) : ''}`;

const group = (g: Partial<LineGroup> & Pick<LineGroup, 'id' | 'cls' | 'members' | 'stage'>): LineGroup => ({
  outputs: [], inputs: [], nominal: [], productivity: 1, state: 'full', band: 'full', reasons: [], ...g,
});
const line = (l: Partial<ProductionLine>): ProductionLine => ({
  id: 'x', products: [], inputs: [], buildings: [], machines: [], groups: [], edges: [], productivity: 1, nominal: 0, actual: 0, ...l,
});

const MINERS = group({ id: 'gM', cls: 'Build_MinerMk2_C', members: ['m1', 'm2', 'm3'], stage: 0, outputs: [{ item: 'Desc_OreIron_C', perMin: 360 }] });
const SMELTERS = group({
  id: 'gS', cls: 'Build_SmelterMk1_C', members: Array.from({ length: 16 }, (_, i) => `s${i}`), stage: 1,
  outputs: [{ item: 'Desc_IronIngot_C', perMin: 360 }], nominal: [{ item: 'Desc_IronIngot_C', perMin: 480 }], productivity: 0.75, state: 'throttled',
  reasons: [{ reason: 'starved', count: 7 }],
});

describe('lineInfo: one reading of a line for the page and the map', () => {
  it('names a line by its products, else what its last group makes, else its machines; never a bare building name', () => {
    expect(lineName(line({ products: [{ item: 'Desc_Wire_C', perMin: 1 }, { item: 'Desc_Cement_C', perMin: 1 }, { item: 'Desc_Computer_C', perMin: 1 }] }), LABELS, 'en'))
      .toBe('Wire, Cement +1');
    const quartz = group({ id: 'q1', cls: 'Build_ConstructorMk1_C', members: ['q1', 'q2'], stage: 1, nominal: [{ item: 'Desc_QuartzCrystal_C', perMin: 50 }] });
    expect(lineName(line({ id: 'q1', groups: [quartz] }), LABELS, 'en')).toBe('QuartzCrystal');
    const burners = group({ id: 'b1', cls: 'Build_GeneratorBiomass_C', members: ['b1', 'b2', 'b3', 'b4'], stage: 2 });
    expect(lineName(line({ id: 'b1', groups: [burners] }), LABELS, 'en')).toBe('4× Biomass Burner');
    // The map names it the same way.
    expect(mapView.lineName(line({ id: 'b1', groups: [burners] }), LABELS, 'en')).toBe('4× Biomass Burner');
  });

  it('names groups like "16× Smelter", a single logistics node by name', () => {
    expect(groupTitle(SMELTERS, LABELS, 'en')).toBe('16× Smelter');
    expect(groupTitle(group({ id: 'gL', cls: 'Build_ConveyorAttachmentMerger_C', members: ['l'], stage: 1, logistics: true }), LABELS, 'en')).toBe('Conveyor Merger');
  });

  it('writes the capacity of a connection per link: "4× Conveyor Belt Mk.1 (60 each)", else the sum', () => {
    const edge = { from: 'a', to: 'b', links: 4, via: [], perMin: 79, capacity: 240, perLink: 60, slowest: 'Build_ConveyorBeltMk1_C' };
    expect(capacityText(edge, LABELS, 'en', t)).toBe('factory.lines.capacityEach{"count":4,"belt":"Conveyor Belt Mk.1","each":"60"}');
    expect(edgeRateText(edge, LABELS, 'en', t)).toBe('factory.unit.solid{"value":"79.0"} · factory.lines.capacityEach{"count":4,"belt":"Conveyor Belt Mk.1","each":"60"}');
    expect(capacityText({ ...edge, links: 1, perLink: undefined, capacity: 120 }, LABELS, 'en', t)).toBe('factory.lines.of{"value":"120"}');
    expect(capacityText({ ...edge, capacity: undefined }, LABELS, 'en', t)).toBeNull();
  });

  it('knows the next belt, lift and pipeline tier', () => {
    expect(nextTier('Build_ConveyorBeltMk1_C')).toBe('Build_ConveyorBeltMk2_C');
    expect(nextTier('Build_ConveyorLiftMk5_C')).toBe('Build_ConveyorLiftMk6_C');
    expect(nextTier('Build_ConveyorBeltMk6_C')).toBeNull();
    expect(nextTier('Build_Pipeline_C')).toBe('Build_PipelineMK2_C');
    expect(nextTier('Build_PipelineMK2_C')).toBeNull();
  });

  it('says the bottleneck in one sentence: a starved group names its short input and what to do', () => {
    const iron = line({
      groups: [MINERS, SMELTERS],
      edges: [{ from: 'gM', to: 'gS', links: 16, via: [], item: 'Desc_OreIron_C', perMin: 360, capacity: 960, perLink: 60, slowest: 'Build_ConveyorBeltMk1_C' }],
      bottleneck: { kind: 'group', group: 'gS', why: 'starved', short: { item: 'Desc_OreIron_C', supply: 360, need: 480, makers: 3, makersProductivity: 1, extractors: true } },
    });
    expect(bottleneckText(iron, LABELS, 'en', t)).toBe(
      'factory.lines.neck.shortFull{"group":"16× Smelter (IronIngot)","item":"OreIron","supply":"360.0","need":"factory.unit.solid{\\"value\\":\\"480.0\\"}",'
      + '"pct":"factory.unit.pct{\\"value\\":\\"100\\"}","fix":"factory.lines.neck.fixMiner{\\"miner\\":\\"Miner Mk.3\\"}"}',
    );
    const full = { ...iron, bottleneck: { kind: 'edge' as const, edge: 0, why: 'capacity' as const } };
    expect(bottleneckText(full, LABELS, 'en', t)).toMatch(/^factory\.lines\.neck\.capacity\{"belt":"Conveyor Belt Mk\.1","from":"3× Miner Mk\.2 \(OreIron\)","to":"16× Smelter \(IronIngot\)".*"fix":"factory\.lines\.neck\.fixTier\{\\"next\\":\\"Conveyor Belt Mk\.2\\"\}"\}$/);
    const end = { ...iron, bottleneck: { kind: 'group' as const, group: 'gS', why: 'demand' as const } };
    expect(bottleneckText(end, LABELS, 'en', t)).toBe('factory.lines.neck.demand{"group":"16× Smelter (IronIngot)"}');
    // The map's words are the page's.
    expect(mapView.bottleneckText(iron, LABELS, 'en', t)).toBe(bottleneckText(iron, LABELS, 'en', t));
  });
});

describe('diffSummary: one grouping of changes for the page and the map', () => {
  const diff: Pick<FactoryDiff, 'classes'> = {
    classes: [
      { cls: 'Build_SmelterMk1_C', added: 4, removed: 1 },
      { cls: 'Build_ConveyorAttachmentMerger_C', added: 10, removed: 2 },
      { cls: 'Build_Foundation_8x4_01_C', added: 3, removed: 0 },
    ],
  };
  it('rows machines, logistics, foundations; belts and floor pieces count when given; "other" only when present', () => {
    expect(diffSummary(diff, LABELS.category)).toEqual([
      { key: 'machines', added: 4, removed: 1 }, { key: 'logistics', added: 10, removed: 2 }, { key: 'foundations', added: 3, removed: 0 },
    ]);
    expect(diffSummary(diff, LABELS.category, { floorAdded: 100, floorRemoved: 5, linesAdded: 20, linesRemoved: 1 })).toEqual([
      { key: 'machines', added: 4, removed: 1 }, { key: 'logistics', added: 30, removed: 3 }, { key: 'foundations', added: 103, removed: 5 },
    ]);
    expect(diffSummary({ classes: [{ cls: 'Build_SignPole_C', added: 1, removed: 0 }] }, LABELS.category).map(r => r.key)).toEqual(['machines', 'logistics', 'foundations', 'other']);
    expect(diffRowOf('Build_Unknown_C', () => undefined)).toBe('other');
  });
});
