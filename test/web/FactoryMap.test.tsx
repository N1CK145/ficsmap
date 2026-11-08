import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { BuildingsFile } from '../../src/shared/buildings.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../src/shared/factory/snapshot.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useFactoryView } from '../../src/web/features/factory/view.js';
import { FactoryInfo } from '../../src/web/features/factory/map/FactoryInfo.js';
import { escapeClosesInfo, stationLabel } from '../../src/web/features/factory/map/FactoryMapLayer.js';
import type { SceneStation } from '../../src/web/features/factory/map/scene.js';
import { FactoryPanel } from '../../src/web/features/factory/map/FactoryPanel.js';
import { HighlightChip } from '../../src/web/features/factory/map/HighlightChip.js';
import { FactoryTimeline } from '../../src/web/features/factory/map/Timeline.js';
import { DEFAULT_VIEW, loadFactoryMapView, useFactoryMap } from '../../src/web/features/factory/map/useFactoryMap.js';
import { useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 256_000, maxY: 256_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'g', name: { en: 'G', de: 'G' } }], items: [], aliases: {},
};
const BUILDINGS: BuildingsFile = {
  version: 'test',
  buildings: {
    Build_ConstructorMk1_C: {
      name: { en: 'Constructor', de: 'Konstruktor' }, category: 'production',
      footprint: { source: 'clearance', boxes: [{ min: [-400, -500, 0], max: [400, 500, 600] }] },
    },
  },
};
const b = (id: string, productivity: number, issues?: ('blocked' | 'starved')[], paused?: boolean): SnapshotBuilding =>
  ({ id, cls: 'Build_ConstructorMk1_C', x: 10_000, y: 10_000, z: 0, yaw: 0, prod: { clock: 1, productivity, ...(issues ? { issues } : {}), ...(paused ? { paused } : {}) } });
const snap = (saveTime: number, buildings: SnapshotBuilding[]): FactorySnapshot => ({
  v: 1, meta: { sessionName: 'Alpha', saveTime, build: 1 }, buildings, lightweight: [], splines: [], powerLines: [], pathNetworks: [],
  stations: [], vehicles: [], markers: [], crates: [],
});
const S1 = snap(Date.UTC(2026, 10, 2, 21), [b('a', 1)]);
const S2 = snap(Date.UTC(2026, 10, 5, 21), [b('a', 1), b('b', 0.3, ['blocked'])]);
const S3 = snap(Date.UTC(2026, 10, 7, 23), [b('a', 0.5, ['starved']), b('b', 0.3, ['blocked']), b('c', 0), b('d', 0, undefined, true)]);
const LIST = [makeSummary(3, S3.meta.saveTime, 'Alpha'), makeSummary(2, S2.meta.saveTime, 'Alpha'), makeSummary(1, S1.meta.saveTime, 'Alpha')];

function setup({ list = LIST, world = WORLD } = {}) {
  const stub = stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: world },
    [`GET /api/worlds/${W}/snapshots`]: { body: list },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: S1 },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: S2 },
    [`GET /api/worlds/${W}/snapshots/3`]: { body: S3 },
    'GET /data/test/buildings.json': { body: BUILDINGS },
    'GET /data/test/collectibles.min.json': { body: DS },
    'GET /data/test/recipes.json': { body: { format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 }, items: [], recipes: [], machines: [], extractors: [] } },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const wrap = (node: ReactNode) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ctx, wrap, stub };
}

beforeEach(() => {
  initI18n(['en']);
  localStorage.clear();
  useFactoryView.getState().reset();
  useFactoryMap.setState({ ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers }, selection: null, pendingFocus: false, returnFocus: null, fittedSeq: 0, fitChangesSeq: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('factory map: remembered view', () => {
  it('starts with the layers off, the productivity colours, and the floor plan, buildings, lines, roads, markers and crates on', () => {
    expect(loadFactoryMapView()).toEqual(DEFAULT_VIEW);
    expect(DEFAULT_VIEW.colorMode).toBe('productivity');
    expect(DEFAULT_VIEW.layers.power).toBe(false);
    expect(DEFAULT_VIEW.layers.fog).toBe(false);
  });

  it('ignores the colour mode of the first stored version (it was saved on every change while "category" was the default)', () => {
    localStorage.setItem('ficsmap:factoryMap', JSON.stringify({ visible: true, colorMode: 'category' }));
    expect(loadFactoryMapView()).toMatchObject({ visible: true, colorMode: 'productivity' });
    useFactoryMap.getState().setColorMode('category');
    expect(loadFactoryMapView().colorMode).toBe('category');
  });

  it('remembers the switch, the layers and the colour mode per device, ignoring broken values', () => {
    useFactoryMap.getState().toggle();
    useFactoryMap.getState().toggleLayer('power');
    useFactoryMap.getState().setColorMode('category');
    const v = loadFactoryMapView();
    expect(v.visible).toBe(true);
    expect(v.layers.power).toBe(true);
    expect(v.colorMode).toBe('category');
    localStorage.setItem('ficsmap:factoryMap', JSON.stringify({ visible: 'yes', layers: { fog: 1, power: true }, colorMode: 'rainbow' }));
    expect(loadFactoryMapView()).toEqual({ ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers, power: true } });
    localStorage.setItem('ficsmap:factoryMap', '{broken');
    expect(loadFactoryMapView()).toEqual(DEFAULT_VIEW);
  });
});

describe('factory map: panel', () => {
  it('switches the layers on and toggles single layers and the colour mode', async () => {
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    const sw = await screen.findByRole('button', { name: /Show the factory/ });
    expect(sw).toHaveAttribute('aria-pressed', 'false');
    await user.click(sw);
    expect(useFactoryMap.getState().visible).toBe(true);
    const power = await screen.findByRole('checkbox', { name: 'Power lines' });
    expect(power).not.toBeChecked();
    await user.click(power);
    expect(useFactoryMap.getState().layers.power).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Category' }));
    expect(useFactoryMap.getState().colorMode).toBe('category');
  });

  it('lists the bands and reasons with counts in the productivity mode; a click shows those machines on the map', async () => {
    useFactoryMap.setState({ visible: true, colorMode: 'productivity' });
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    const legend = await screen.findByTestId('factory-legend');
    const throttled = await within(legend).findByRole('button', { name: /Part load/ });
    expect(throttled).toHaveTextContent('2');
    await user.click(throttled);
    expect([...useFactoryView.getState().highlight].sort()).toEqual(['a', 'b']);
    expect(useFactoryView.getState().highlightSeq).toBe(1);
    const blocked = within(legend).getByRole('button', { name: /Backed up/ });
    expect(blocked).toHaveTextContent('1');
    // Paused machines are a state of their own, not counted as standing.
    expect(within(legend).getByRole('button', { name: /Stopped/ })).toHaveTextContent('1');
    const paused = within(legend).getAllByRole('button', { name: /Paused/ })[0]!;
    expect(paused).toHaveTextContent('1');
    // Not repeated among the reasons.
    expect(within(legend).getAllByRole('button', { name: /Paused/ })).toHaveLength(1);
    await user.click(paused);
    expect(useFactoryView.getState().highlight).toEqual(['d']);
  });

  it('clears the marking with a button', async () => {
    useFactoryMap.setState({ visible: true });
    useFactoryView.getState().showOnMap(['a', 'b']);
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    await user.click(await screen.findByRole('button', { name: /Clear the outline/ }));
    expect(useFactoryView.getState().highlight).toEqual([]);
  });

  it('explains how to get a factory without snapshots and offers the two import modes to the owner', async () => {
    const { wrap } = setup({ list: [] });
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    const empty = await screen.findByTestId('factory-empty');
    expect(empty).toHaveTextContent('No factory data yet');
    await user.click(within(empty).getByRole('button', { name: 'Add older saves' }));
    expect(useImportDialog.getState()).toMatchObject({ open: true, mode: 'older' });
    useImportDialog.getState().hide();
  });

  it('does not offer the import to members', async () => {
    const { wrap } = setup({ list: [], world: { ...WORLD, isOwner: false } });
    wrap(<FactoryPanel worldId={W} />);
    const empty = await screen.findByTestId('factory-empty');
    expect(within(empty).queryByRole('button')).toBeNull();
  });
});

describe('factory map: timeline', () => {
  it('shows nothing while the layers are off', () => {
    const { ctx, wrap } = setup();
    wrap(<FactoryTimeline ctx={ctx} />);
    expect(screen.queryByTestId('factory-timeline')).toBeNull();
  });

  it('steps through the saves with the buttons, the diamonds and the arrow keys; the newest stays "newest"', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryTimeline ctx={ctx} />);
    const bar = await screen.findByRole('region', { name: 'Timeline' });
    expect(within(bar).getByText('3 of 3')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Next save' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(bar).getByRole('button', { name: 'Previous save' }));
    expect(useFactoryView.getState().selectedId).toBe(2);
    expect(within(bar).getByText('2 of 3')).toBeInTheDocument();
    // Arrow keys on the bar's buttons.
    within(bar).getByRole('button', { name: 'Previous save' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(useFactoryView.getState().selectedId).toBe(1);
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(useFactoryView.getState().selectedId).toBeNull();
    const track = within(bar).getByRole('radiogroup', { name: 'Saves' });
    const points = within(track).getAllByRole('radio');
    expect(points).toHaveLength(3);
    expect(points[2]).toHaveAttribute('aria-checked', 'true');
    await user.click(points[0]!);
    expect(useFactoryView.getState().selectedId).toBe(1);
    // Arrow keys on a diamond move the selection and the focus.
    points[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(useFactoryView.getState().selectedId).toBe(2);
    expect(within(track).getAllByRole('radio')[1]).toHaveFocus();
    // The date is announced; the loading note is always there.
    expect(within(bar).getByTestId('timeline-date')).toHaveAttribute('aria-live', 'polite');
    expect(within(bar).getByRole('status')).toBeInTheDocument();
  });

  it('marks changes against the save before and counts them', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryTimeline ctx={ctx} />);
    const bar = await screen.findByRole('region', { name: 'Timeline' });
    const changes = within(bar).getByRole('button', { name: 'Changes' });
    expect(changes).toHaveAttribute('aria-pressed', 'false');
    await user.click(changes);
    expect(useFactoryView.getState().compareId).toBe(2);
    expect(changes).toHaveAttribute('aria-pressed', 'true');
    const counts = await within(bar).findByTestId('timeline-counts');
    // 05.11 → 07.11: c built, a dropped from 100 % to 50 %.
    await waitFor(() => expect(counts).toHaveTextContent('+2 buildings'));
    expect(counts).toHaveTextContent('1 worse');
    await user.click(within(counts).getByRole('button', { name: 'Go to the changes' }));
    expect(useFactoryMap.getState().fitChangesSeq).toBe(1);
    // Stepping back keeps comparing with the save before.
    await user.click(within(bar).getByRole('button', { name: 'Previous save' }));
    await waitFor(() => expect(useFactoryView.getState().compareId).toBe(1));
    // A chosen save stays chosen.
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Compare with' }), String(3));
    expect(useFactoryMap.getState().compareMode).toBe('chosen');
    expect(useFactoryView.getState().compareId).toBe(3);
    await user.click(changes);
    expect(useFactoryView.getState().compareId).toBeNull();
  });

  it('shows the empty state with the import modes when the world has no snapshots', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup({ list: [] });
    const user = userEvent.setup();
    wrap(<FactoryTimeline ctx={ctx} />);
    const empty = await screen.findByTestId('factory-empty');
    await user.click(within(empty).getByRole('button', { name: 'Import save' }));
    expect(useImportDialog.getState()).toMatchObject({ open: true, mode: 'save' });
    useImportDialog.getState().hide();
  });
});

describe('factory map: marking and info window', () => {
  it('says how many buildings are marked and clears them with a 44 px button', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(<HighlightChip ctx={ctx} />);
    expect(screen.queryByTestId('factory-highlight-chip')).toBeNull();
    act(() => useFactoryView.getState().showOnMap(['a', 'b', 'c']));
    const chip = await screen.findByTestId('factory-highlight-chip');
    expect(chip).toHaveTextContent('3 buildings marked');
    const clear = within(chip).getByRole('button', { name: 'Clear the marking' });
    expect(clear.className).toContain('size-11');
    await user.click(clear);
    expect(useFactoryView.getState().highlight).toEqual([]);
  });

  it('moves the focus to its title when opened from a button and gives it back on close', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(
      <>
        <button type="button" onClick={e => useFactoryMap.getState().select({ kind: 'building', id: 'b' }, { focus: true, opener: e.currentTarget })}>Open</button>
        <FactoryInfo ctx={ctx} />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const title = await screen.findByRole('heading', { name: 'Constructor' });
    await waitFor(() => expect(title).toHaveFocus());
    const info = screen.getByRole('complementary', { name: 'Constructor' });
    // A short subtitle and no coordinates footer.
    expect(info).toHaveTextContent('Production');
    expect(info).not.toHaveTextContent(/X\s.*Y\s/);
    await user.click(within(info).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes on Esc only when nothing else took the key', () => {
    const at = (target: EventTarget | null, defaultPrevented = false) => ({ key: 'Escape', defaultPrevented, target });
    document.body.innerHTML = '<input id="i" /><div role="dialog"><button id="d"></button></div><button id="m"></button>';
    expect(escapeClosesInfo(at(document.getElementById('m')))).toBe(true);
    expect(escapeClosesInfo(at(document.body))).toBe(true);
    expect(escapeClosesInfo(at(document.getElementById('i')))).toBe(false);
    expect(escapeClosesInfo(at(document.getElementById('d')))).toBe(false);
    expect(escapeClosesInfo(at(document.getElementById('m'), true))).toBe(false);
    expect(escapeClosesInfo({ key: 'Enter', defaultPrevented: false, target: null })).toBe(false);
    document.body.innerHTML = '';
  });
});

describe('factory map: station plates', () => {
  const visit = (fill: number | null, itemsPerMin: number) => ({ vehicle: 'v', empty: itemsPerMin <= 0, fill, fillApprox: false, itemsPerDock: 10, interval: 60, itemsPerMin, capacityStacks: 8, capacityFluid: null });
  const station = (state: SceneStation['state'], visits: ReturnType<typeof visit>[], cargo = [{ item: 'Desc_IronPlate_C', count: 50 }]) => ({
    s: { id: 's', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, yaw: 0, loading: true, traffic: [] }, cx: 0, cy: 0, state,
    flow: { id: 's', cls: 'Build_TruckStation_C', x: 0, y: 0, z: 0, loading: true, visits, itemsPerMin: visits.reduce((a, v) => a + v.itemsPerMin, 0), interval: 60, combinedInterval: 60, cargo, problem: null },
  }) as unknown as SceneStation;
  const number = new Intl.NumberFormat('en');

  it('says rate and how full, with what lies in it; problem stations are marked', () => {
    const i18n = initI18n(['en']);
    const t = i18n.t.bind(i18n) as (k: string, o?: Record<string, unknown>) => string;
    expect(stationLabel(station('active', [visit(0.8, 120), visit(0.6, 60)]), t, number)).toEqual({ text: '↑ 180 /min · 70 %', problem: false, item: 'Desc_IronPlate_C' });
    expect(stationLabel(station('empty', [visit(null, 0)], []), t, number)).toEqual({ text: '↑ 0 /min', problem: true, item: null });
    expect(stationLabel(station('idle', []), t, number).problem).toBe(true);
  });
});
