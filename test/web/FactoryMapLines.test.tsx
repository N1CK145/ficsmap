import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexBuildings, type BuildingsFile } from '../../src/shared/buildings.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { LineEdge, ProductionLine, ProductionLines } from '../../src/shared/factory/lines.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import type { FactoryLabels } from '../../src/web/features/factory/data.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { FactoryInfo } from '../../src/web/features/factory/map/FactoryInfo.js';
import { FactoryPanel } from '../../src/web/features/factory/map/FactoryPanel.js';
import { clickFactory, escapeStepsBack } from '../../src/web/features/factory/map/FactoryMapLayer.js';
import {
  bottleneckText, chevronsAlong, edgeLoad, lineGeometry, lineHasIssue, lineName, lineOf, midOf, orientPath, pickLineSpline, shownLine, sortLines,
} from '../../src/web/features/factory/map/lineView.js';
import { buildScene } from '../../src/web/features/factory/map/scene.js';
import { DEFAULT_VIEW, useFactoryMap } from '../../src/web/features/factory/map/useFactoryMap.js';
import { useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';

// The real `buildLines` comes with feature/lines-data; the map is tested against fixture lines.
const lines = vi.hoisted(() => ({ current: null as ProductionLines | null }));
vi.mock('../../src/shared/factory/lines.js', async orig => ({
  ...(await orig<typeof import('../../src/shared/factory/lines.js')>()),
  buildLines: () => lines.current ?? { lines: [], index: new Map() },
}));

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 256_000, maxY: 256_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'G', de: 'G' } }], items: [], aliases: {},
};
const box = { source: 'clearance' as const, boxes: [{ min: [-400, -500, 0] as [number, number, number], max: [400, 500, 600] as [number, number, number] }] };
const BUILDINGS: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_ConstructorMk1_C: { name: { en: 'Constructor', de: 'Konstruktor' }, category: 'production', footprint: box },
    Build_SmelterMk1_C: { name: { en: 'Smelter', de: 'Schmelzofen' }, category: 'production', footprint: box },
    Build_ConveyorBeltMk1_C: { name: { en: 'Conveyor Belt Mk.1', de: 'Förderband Mk.1' }, category: 'logistics-belt' },
  },
};

const machine = (id: string, cls: string, x: number, productivity = 1): SnapshotBuilding =>
  ({ id, cls, x, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity } });
const SNAP: FactorySnapshot = {
  v: 1, meta: { sessionName: 'Alpha', saveTime: Date.UTC(2026, 10, 8, 12), build: 1 },
  buildings: [
    machine('s1', 'Build_SmelterMk1_C', 10_000), machine('s2', 'Build_SmelterMk1_C', 12_000), machine('c1', 'Build_ConstructorMk1_C', 20_000, 0.6),
    machine('i1', 'Build_ConstructorMk1_C', 40_000), machine('i2', 'Build_ConstructorMk1_C', 42_000), machine('i3', 'Build_ConstructorMk1_C', 44_000),
    machine('i4', 'Build_ConstructorMk1_C', 46_000), machine('q1', 'Build_ConstructorMk1_C', 60_000, 0.2),
  ],
  splines: [
    { id: 'belt1', cls: 'Build_ConveyorBeltMk1_C', pts: [12_000, 10_000, 0, 16_000, 10_000, 0, 20_000, 10_000, 0] },
    // Between the two smelters: inside their group, no connection between groups.
    { id: 'belt2', cls: 'Build_ConveyorBeltMk1_C', pts: [10_000, 11_000, 0, 12_000, 11_000, 0] },
  ],
  links: [{ from: 's1', to: 'c1', kind: 'belt', via: ['belt1'] }],
  lightweight: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
};
const NO_LINKS: FactorySnapshot = { ...SNAP, meta: { ...SNAP.meta, saveTime: Date.UTC(2026, 10, 2, 12) }, links: undefined };

const edge = (e: Partial<LineEdge>): LineEdge => ({ from: 'gS', to: 'gC', links: 1, via: [], ...e });
const line = (l: Partial<ProductionLine> & { id: string; machines: string[] }): ProductionLine => ({
  products: [], inputs: [], buildings: l.machines, groups: [], edges: [], productivity: 1, nominal: 0, actual: 0, ...l,
});
/** Copper wire: two smelters feed a constructor over a full Mk.1 belt (the bottleneck). */
const COPPER = line({
  id: 'c1', machines: ['s1', 's2', 'c1'], productivity: 0.8, nominal: 40, actual: 30,
  products: [{ item: 'Desc_Wire_C', perMin: 30 }], inputs: [{ item: 'Desc_OreCopper_C', perMin: 60 }],
  groups: [
    { id: 'gS', cls: 'Build_SmelterMk1_C', members: ['s1', 's2'], stage: 1, outputs: [], inputs: [], nominal: [], productivity: 1, state: 'full', reasons: [] },
    { id: 'gC', cls: 'Build_ConstructorMk1_C', members: ['c1'], stage: 2, outputs: [], inputs: [], nominal: [], productivity: 0.6, state: 'throttled', reasons: [] },
  ],
  edges: [edge({ item: 'Desc_CopperIngot_C', perMin: 60, capacity: 60, slowest: 'Build_ConveyorBeltMk1_C', via: ['belt1'], saturated: true })],
  bottleneck: { kind: 'edge', edge: 0, why: 'capacity' },
  via: ['belt1', 'belt2'],
});
/** Iron plates: four constructors, no problem. */
const IRON = line({ id: 'i4', machines: ['i1', 'i2', 'i3', 'i4'], products: [{ item: 'Desc_IronPlate_C', perMin: 80 }], productivity: 1, nominal: 80, actual: 80 });
/** Screws: one constructor short of input. */
const SCREWS = line({
  id: 'q1', machines: ['q1'], productivity: 0.2, products: [{ item: 'Desc_IronScrew_C', perMin: 8 }], nominal: 40, actual: 8,
  groups: [{ id: 'gQ', cls: 'Build_ConstructorMk1_C', members: ['q1'], stage: 1, outputs: [], inputs: [], nominal: [], productivity: 0.2, state: 'throttled', reasons: [{ reason: 'starved', count: 1 }] }],
  bottleneck: { kind: 'group', group: 'gQ', why: 'starved' },
});
const LINES: ProductionLines = {
  lines: [IRON, SCREWS, COPPER],
  index: new Map([
    ...COPPER.buildings.map(b => [b, 'c1'] as const), ['belt1', 'c1'], ['belt2', 'c1'], ...IRON.buildings.map(b => [b, 'i4'] as const), ['q1', 'q1'],
  ]),
};

const LABELS: FactoryLabels = {
  building: cls => ({ Build_SmelterMk1_C: 'Smelter', Build_ConstructorMk1_C: 'Constructor', Build_ConveyorBeltMk1_C: 'Conveyor Belt Mk.1' } as Record<string, string>)[cls] ?? cls,
  buildingPicture: cls => cls,
  category: () => undefined,
  item: cls => cls.replace(/^Desc_|_C$/g, ''),
  isFluid: () => false,
};
const t = (k: string, o?: Record<string, unknown>) => `${k}${o ? JSON.stringify(o) : ''}`;

function setup({ list = [makeSummary(2, SNAP.meta.saveTime, 'Alpha')], world = WORLD } = {}) {
  const navigated: string[] = [];
  stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: world },
    [`GET /api/worlds/${W}/snapshots`]: { body: list },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: NO_LINKS },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: SNAP },
    'GET /data/test/buildings.json': { body: BUILDINGS },
    'GET /data/test/collectibles.min.json': { body: DS },
    'GET /data/test/recipes.json': { body: { format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 }, items: [], recipes: [], machines: [], extractors: [] } },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world, me: ME, index: indexDataset(DS), queryClient: client, navigate: to => navigated.push(to), toast: { show: () => {} } };
  const wrap = (node: ReactNode) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ctx, wrap, navigated };
}

beforeEach(() => {
  initI18n(['en']);
  localStorage.clear();
  lines.current = LINES;
  useFactoryView.getState().reset();
  useFactoryMap.setState({
    ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers }, selection: null, pendingFocus: false, returnFocus: null, fittedSeq: 0, fitChangesSeq: 0,
    hoverLineId: null, fittedLineId: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('production lines: order, words and load', () => {
  it('lists lines with a problem first, then by lost machine-equivalents (as the Fabrik page)', () => {
    // Screws lose 0.8 machine-equivalents, copper 0.4.
    expect(sortLines(LINES.lines).map(l => l.id)).toEqual(['q1', 'c1', 'i4']);
    expect(lineHasIssue(IRON)).toBe(false);
    // Running out of takers is the end of a line, not a fault in it.
    expect(lineHasIssue({ ...SCREWS, bottleneck: { kind: 'group', group: 'gQ', why: 'demand' } })).toBe(false);
  });

  it('names a line and its bottleneck as the Fabrik page does', () => {
    expect(lineName(COPPER, LABELS, 'en')).toBe('Wire');
    expect(lineName({ ...COPPER, products: [...COPPER.products, { item: 'Desc_Cable_C', perMin: 5 }] }, LABELS, 'en')).toBe('Wire, Cable');
    expect(bottleneckText(COPPER, LABELS, 'en', t)).toMatch(/^factory\.lines\.neck\.capacity\{"belt":"Conveyor Belt Mk\.1","from":"2× Smelter","to":"1× Constructor"/);
    expect(bottleneckText(SCREWS, LABELS, 'en', t)).toBe('factory.lines.neck.group{"group":"1× Constructor","why":"factory.reason.starved"}');
    expect(bottleneckText(IRON, LABELS, 'en', t)).toBeNull();
  });

  it('grades a connection by its flow against the capacity of its slowest belt', () => {
    expect(edgeLoad(edge({ perMin: 10, capacity: 60 }))).toBe('low');
    expect(edgeLoad(edge({ perMin: 40, capacity: 60 }))).toBe('mid');
    expect(edgeLoad(edge({ perMin: 58, capacity: 60 }))).toBe('saturated');
    expect(edgeLoad(edge({ perMin: 10, capacity: 60, saturated: true }))).toBe('saturated');
    expect(edgeLoad(edge({ perMin: 10 }))).toBe('unknown');
  });

  it('lights up the hovered line over the chosen one', () => {
    expect(shownLine(LINES, 'q1', 'c1')?.id).toBe('q1');
    expect(shownLine(LINES, null, 'c1')?.id).toBe('c1');
    expect(shownLine(LINES, 'gone', 'c1')?.id).toBe('c1');
    expect(shownLine(LINES, null, null)).toBeUndefined();
    expect(shownLine(null, 'c1', 'c1')).toBeUndefined();
  });
});

describe('production lines: geometry', () => {
  const index = indexBuildings(BUILDINGS);

  it('collects the buildings and belts of a line, the bottleneck marked, its glyph in the middle of the belt', () => {
    const scene = buildScene(SNAP, index, DS.bounds);
    const g = lineGeometry(scene, COPPER);
    expect(g.buildings.map(sb => sb.b.id).sort()).toEqual(['c1', 's1', 's2']);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ load: 'saturated', bottleneck: true, belt: true });
    expect(g.edges[0]!.paths).toHaveLength(1);
    // The belt inside the smelters' group is drawn too.
    expect(g.inner).toHaveLength(1);
    expect(g.edges[0]!.mid!.x).toBeCloseTo(16_000 * (256 / 256_000));
    expect(g.box).not.toBeNull();
    // Built once per scene and line.
    expect(lineGeometry(scene, COPPER)).toBe(g);
  });

  it('finds the belt of a line under the pointer, not one of no line', () => {
    const scene = buildScene(SNAP, index, DS.bounds);
    const u = 256 / 256_000;
    expect(pickLineSpline(scene, LINES, 16_000 * u, 10_050 * u, 0.5)).toBe('belt1');
    expect(pickLineSpline(scene, LINES, 16_000 * u, 13_000 * u, 0.5)).toBeNull();
    expect(pickLineSpline(scene, { lines: [], index: new Map() }, 16_000 * u, 10_000 * u, 0.5)).toBeNull();
  });

  it('keeps a belt in its spline direction and turns a pipe to run from the upstream side', () => {
    const backwards = new Float32Array([10, 0, 5, 0, 0, 0]);
    const from = { x: 0, y: 0 }, to = { x: 10, y: 0 };
    expect([...orientPath(backwards, true, from, to)]).toEqual([10, 0, 5, 0, 0, 0]);
    expect([...orientPath(backwards, false, from, to)]).toEqual([0, 0, 5, 0, 10, 0]);
  });

  it('puts chevrons along a path at even spacing in its direction, only on screen', () => {
    const c = chevronsAlong([0, 0, 100, 0, 100, 100], 40, 1000, 1000);
    expect(c.map(p => [Math.round(p.x), Math.round(p.y)])).toEqual([[20, 0], [60, 0], [100, 0], [100, 40], [100, 80]]);
    expect(c[0]!.a).toBe(0);
    expect(c[4]!.a).toBeCloseTo(Math.PI / 2);
    expect(chevronsAlong([0, 0, 100, 0], 40, 30, 30, 0)).toHaveLength(1);
    expect(midOf([0, 0, 10, 0, 10, 10])).toEqual({ x: 10, y: 0, a: 0 });
  });
});

describe('production lines: hover and selection on the map', () => {
  it('chooses the line on a first click, opens the building on a click within the chosen line, keeps the line on empty ground', () => {
    clickFactory({ kind: 'building', id: 's1' }, LINES);
    expect(useFactoryView.getState().lineId).toBe('c1');
    expect(useFactoryMap.getState().selection).toBeNull();
    // No fit: the line is where the user clicked; the building tapped is the anchor the map pans clear of the card.
    expect(useFactoryMap.getState().fittedLineId).toBe('c1');
    expect(useFactoryMap.getState()).toMatchObject({ lineAnchor: 's1', openedLineId: 'c1' });
    clickFactory({ kind: 'building', id: 'c1' }, LINES);
    expect(useFactoryMap.getState().selection).toEqual({ kind: 'building', id: 'c1' });
    expect(useFactoryView.getState().lineId).toBe('c1');
    clickFactory(null, LINES);
    expect(useFactoryMap.getState().selection).toBeNull();
    expect(useFactoryView.getState().lineId).toBe('c1');
    // Another line's building switches the line.
    clickFactory({ kind: 'building', id: 'q1' }, LINES);
    expect(useFactoryView.getState().lineId).toBe('q1');
    // A belt of a line chooses that line too.
    clickFactory(null, LINES, 'belt1');
    expect(useFactoryView.getState().lineId).toBe('c1');
    // A boundary building in two lines (a station) stays with the chosen line.
    const shared: ProductionLines = { ...LINES, index: new Map([...LINES.index, ['q1', 'c1']]) };
    useFactoryView.getState().selectLine('q1');
    clickFactory({ kind: 'building', id: 'q1' }, shared);
    expect(useFactoryView.getState().lineId).toBe('q1');
    expect(useFactoryMap.getState().selection).toEqual({ kind: 'building', id: 'q1' });
    expect(lineOf(shared, 'q1')?.id).toBe('c1');
    expect(lineOf(shared, 'q1', 'q1')?.id).toBe('q1');
    // Without lines (an older import) a click opens the building as before.
    useFactoryView.getState().selectLine(null);
    clickFactory({ kind: 'building', id: 's2' }, null);
    expect(useFactoryMap.getState().selection).toEqual({ kind: 'building', id: 's2' });
  });

  it('steps back with Esc: the building first, then the line', () => {
    const esc = { key: 'Escape', defaultPrevented: false, target: document.body };
    useFactoryMap.setState({ visible: true });
    useFactoryView.getState().selectLine('c1');
    useFactoryMap.getState().select({ kind: 'building', id: 'c1' });
    expect(escapeStepsBack(esc)).toBe(true);
    expect(useFactoryMap.getState().selection).toBeNull();
    expect(useFactoryView.getState().lineId).toBe('c1');
    expect(escapeStepsBack(esc)).toBe(true);
    expect(useFactoryView.getState().lineId).toBeNull();
    expect(escapeStepsBack(esc)).toBe(false);
  });

  it('fits the map to a line chosen elsewhere (the diagram, the list, "Zur Linie"), not to one clicked on the map', () => {
    // The line diagram's "Karte" only chooses the line: it differs from what the map last showed, so the map fits.
    useFactoryView.getState().selectLine('c1');
    expect(useFactoryMap.getState().fittedLineId).toBeNull();
    useFactoryMap.getState().setFittedLineId('c1');
    // "Zur Linie" asks again.
    useFactoryMap.getState().requestLineFit();
    expect(useFactoryMap.getState().fittedLineId).toBeNull();
    // The list reveals, a click on the map does not.
    useFactoryMap.getState().openLine('q1', { reveal: true });
    expect(useFactoryMap.getState().fittedLineId).toBeNull();
    useFactoryMap.getState().openLine('i4');
    expect(useFactoryMap.getState().fittedLineId).toBe('i4');
    expect(useFactoryView.getState().lineId).toBe('i4');
  });
});

describe('production lines: panel list', () => {
  it('lists the lines problems first; a row lights its line up while pointed at or focused, a click chooses and fits', async () => {
    useFactoryMap.setState({ visible: true });
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    const section = await screen.findByTestId('factory-lines');
    const list = await within(section).findByRole('list', { name: 'Production lines' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/^Iron Screw.*1 machine.*20 %$/),
      expect.stringMatching(/^Wire.*3 machines.*80 %$/),
      expect.stringMatching(/^Iron Plate.*4 machines.*100 %$/),
    ]);
    expect(rows[0]).toHaveTextContent('With a bottleneck:');
    expect(rows[2]).not.toHaveTextContent('With a bottleneck:');
    expect(screen.getByText('3 lines, 2 with a bottleneck')).toBeInTheDocument();

    await user.hover(rows[1]!);
    expect(useFactoryMap.getState().hoverLineId).toBe('c1');
    await user.unhover(rows[1]!);
    expect(useFactoryMap.getState().hoverLineId).toBeNull();
    act(() => rows[2]!.focus());
    expect(useFactoryMap.getState().hoverLineId).toBe('i4');

    await user.click(rows[0]!);
    expect(useFactoryView.getState().lineId).toBe('q1');
    expect(useFactoryMap.getState().fittedLineId).toBeNull();
    expect(useFactoryMap.getState().pendingFocus).toBe(true);
    expect(useFactoryMap.getState().returnFocus === rows[0]).toBe(true);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
  });

  it('says that connections are missing in an older import and offers the import to the owner', async () => {
    useFactoryMap.setState({ visible: true });
    const { wrap } = setup({ list: [makeSummary(1, NO_LINKS.meta.saveTime, 'Alpha')] });
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    const missing = await screen.findByTestId('factory-lines-missing');
    expect(missing).toHaveTextContent('Connections are missing in this save – import it again.');
    await user.click(within(missing).getByRole('button', { name: 'Import save' }));
    expect(useImportDialog.getState()).toMatchObject({ open: true, mode: 'save' });
    useImportDialog.getState().hide();
  });

  it('does not offer the import to members', async () => {
    useFactoryMap.setState({ visible: true });
    const { wrap } = setup({ list: [makeSummary(1, NO_LINKS.meta.saveTime, 'Alpha')], world: { ...WORLD, isOwner: false } });
    wrap(<FactoryPanel worldId={W} />);
    const missing = await screen.findByTestId('factory-lines-missing');
    expect(missing).toHaveTextContent('The owner of this world can import it again.');
    expect(within(missing).queryByRole('button')).toBeNull();
  });

  it('says so when a save with connections has no lines', async () => {
    lines.current = { lines: [], index: new Map() };
    useFactoryMap.setState({ visible: true });
    const { wrap } = setup();
    wrap(<FactoryPanel worldId={W} />);
    const section = await screen.findByTestId('factory-lines');
    await waitFor(() => expect(section).toHaveTextContent('No machines in this save are connected'));
  });
});

describe('production lines: card', () => {
  it('shows the chosen line, announces it, opens the diagram and fits the map to it', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap, navigated } = setup();
    const user = userEvent.setup();
    wrap(<FactoryInfo ctx={ctx} />);
    act(() => useFactoryMap.getState().openLine('c1'));
    const card = await screen.findByTestId('factory-line-card');
    const info = screen.getByRole('complementary', { name: 'Wire' });
    expect(info).toHaveTextContent('Production line');
    expect(card).toHaveTextContent('Bottleneck: Conveyor Belt Mk.1 full between 2× Smelter and 1× Constructor');
    expect(card).toHaveTextContent('30.0/min of target 40.0/min');
    // The machines by class, each a button that outlines them on the map.
    const machines = within(card).getByTestId('factory-line-machines');
    expect(machines).toHaveTextContent('2 ×SmelterOn the map1 ×ConstructorOn the map');
    expect(within(card).getByRole('heading', { name: 'Supplied' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('factory-line-announce')).toHaveTextContent(/^Production line Wire: 3 machines, mean 80 %\. Bottleneck: /));

    await user.click(within(machines).getByRole('button', { name: /Smelter/ }));
    expect(useFactoryView.getState().highlight).toEqual(['s1', 's2']);

    useFactoryMap.getState().setFittedLineId('c1');
    await user.click(within(card).getByRole('button', { name: 'Go to line' }));
    expect(useFactoryMap.getState().fittedLineId).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'As diagram' }));
    expect(navigated).toEqual([`/w/${W}/factory?line=c1`]);
    expect(useFactoryView.getState().lineId).toBe('c1');

    // A building of the line opens with the way back to the line's card.
    act(() => useFactoryMap.getState().select({ kind: 'building', id: 'c1' }));
    const back = await screen.findByTestId('factory-line-back');
    expect(back).toHaveTextContent('Part of the production line');
    await user.click(back);
    expect(useFactoryMap.getState().selection).toBeNull();
    expect(await screen.findByTestId('factory-line-card')).toBeInTheDocument();

    // × closes the line.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(useFactoryView.getState().lineId).toBeNull();
    expect(screen.queryByTestId('factory-line-card')).toBeNull();
  });
});
