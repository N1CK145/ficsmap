import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { FactoryTimeline, nearestIndex } from '../../src/web/features/factory/map/Timeline.js';
import { DEFAULT_VIEW, loadFactoryMapView, useFactoryMap } from '../../src/web/features/factory/map/useFactoryMap.js';
import { usePanelsCollapsed } from '../../src/web/features/worlds/SidebarPanelView.js';
import { useImportDialog } from '../../src/web/features/import/ImportDialog.js';
import { makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
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

function setup({ list = LIST, world = WORLD, recipes = true } = {}) {
  const stub = stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: world },
    [`GET /api/worlds/${W}/snapshots`]: { body: list },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: S1 },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: S2 },
    [`GET /api/worlds/${W}/snapshots/3`]: { body: S3 },
    'GET /data/test/buildings.json': { body: BUILDINGS },
    'GET /data/test/collectibles.min.json': { body: DS },
    ...(recipes ? { 'GET /data/test/recipes.json': { body: { format: 1, source: 'test', clock: { min: 0.01, perShard: 0.5 }, items: [], recipes: [], machines: [], extractors: [] } } } : {}),
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
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
    const { wrap } = setup({ list: [], world: { ...WORLD, role: 'member' } });
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

  it('steps through the saves with the buttons, the slider and the arrow keys; the newest stays "newest"', async () => {
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
    const slider = within(bar).getByRole('slider', { name: 'Saves' });
    expect(slider).toHaveAttribute('aria-valuenow', '3');
    expect(slider).toHaveAttribute('aria-valuemax', '3');
    // Keys on the slider: Home, End, the arrows (also up and down); the focus stays on it.
    slider.focus();
    await user.keyboard('{Home}');
    expect(useFactoryView.getState().selectedId).toBe(1);
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    await user.keyboard('{ArrowUp}');
    expect(useFactoryView.getState().selectedId).toBe(2);
    expect(slider).toHaveFocus();
    await user.keyboard('{End}');
    expect(useFactoryView.getState().selectedId).toBeNull();
    // The date is announced; the loading note is always there.
    expect(within(bar).getByTestId('timeline-date')).toHaveAttribute('aria-live', 'polite');
    expect(within(bar).getByRole('status')).toBeInTheDocument();
  });

  it('snaps the slider to the nearest save', () => {
    expect(nearestIndex([0, 59, 100], 0)).toBe(0);
    expect(nearestIndex([0, 59, 100], 40)).toBe(1);
    expect(nearestIndex([0, 59, 100], 85)).toBe(2);
    expect(nearestIndex([50], 3)).toBe(0);
  });

  it('follows a drag along the track: the handle at once, the map once the pointer rests or lets go', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    wrap(<FactoryTimeline ctx={ctx} />);
    const bar = await screen.findByRole('region', { name: 'Timeline' });
    const track = within(bar).getByTestId('timeline-track');
    const slider = within(bar).getByRole('slider', { name: 'Saves' });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, top: 0, bottom: 44, width: 300, height: 44, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: 2 });
    // The handle and the date move at once; the map follows when the pointer rests.
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    expect(slider).toHaveFocus();
    expect(useFactoryView.getState().selectedId).toBeNull();
    await waitFor(() => expect(useFactoryView.getState().selectedId).toBe(1));
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 170 });
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 299 });
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 299 });
    // Let go: the save under it shows right away (the newest stays "newest").
    expect(useFactoryView.getState().selectedId).toBeNull();
    expect(slider).toHaveAttribute('aria-valuenow', '3');
  });

  it('plays from the oldest save to the newest at the chosen speed, remembered', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryTimeline ctx={ctx} />);
    const bar = await screen.findByRole('region', { name: 'Timeline' });
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Playback speed' }), '4');
    expect(useFactoryMap.getState().playSpeed).toBe(4);
    expect(loadFactoryMapView().playSpeed).toBe(4);
    // At the newest save, play starts again at the oldest.
    await user.click(within(bar).getByRole('button', { name: 'Play' }));
    expect(useFactoryView.getState().selectedId).toBe(1);
    expect(within(bar).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await waitFor(() => expect(useFactoryView.getState().selectedId).toBe(2), { timeout: 2000 });
    // It stops at the newest.
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Play' })).toBeInTheDocument(), { timeout: 2000 });
    expect(useFactoryView.getState().selectedId).toBeNull();
    // A step by hand stops playing.
    await user.click(within(bar).getByRole('button', { name: 'Play' }));
    await user.click(within(bar).getByRole('button', { name: 'Next save' }));
    expect(within(bar).getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(useFactoryView.getState().selectedId).toBe(2);
  });

  it('keeps the Fabrikplan panel still while the timeline is in use; it catches up when the user turns to it', async () => {
    useFactoryMap.setState({ visible: true });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(<><FactoryPanel worldId={W} /><FactoryTimeline ctx={ctx} /></>);
    const bar = await screen.findByRole('region', { name: 'Timeline' });
    const save = await screen.findByTestId('factory-panel-save');
    const newest = save.textContent;
    await user.click(within(bar).getByRole('button', { name: 'Previous save' }));
    await user.click(within(bar).getByRole('button', { name: 'Previous save' }));
    expect(useFactoryView.getState().selectedId).toBe(1);
    // The panel still shows the save it showed, faded, until the timeline rests.
    expect(save.textContent).toBe(newest);
    expect(save.parentElement).toHaveAttribute('aria-busy', 'true');
    fireEvent.pointerEnter(save.parentElement!);
    fireEvent.focus(within(save.parentElement!).getAllByRole('button')[0]!);
    expect(save.textContent).not.toBe(newest);
    expect(save).toHaveTextContent('1 buildings');
    expect(save.parentElement).not.toHaveAttribute('aria-busy');
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
    // The Fabrik page's rows (`diffSummary`): machines, logistics, foundations.
    await waitFor(() => expect(counts).toHaveTextContent('Machines+2'));
    expect(counts).toHaveTextContent('Foundationsunchanged');
    expect(counts).toHaveTextContent('1 worse');
    await user.click(within(counts).getByRole('button', { name: 'Go to the changes' }));
    expect(useFactoryMap.getState().fitChangesSeq).toBe(1);
    // With several areas the button steps through them: "Area 1 of 3 ›", then the next, round again after the last.
    act(() => useFactoryMap.setState({ changeAreaCount: 3, changeArea: -1 }));
    act(() => useFactoryMap.getState().requestFitChanges());
    expect(within(counts).getByTestId('timeline-to-changes')).toHaveTextContent('Area 1 of 3');
    act(() => { useFactoryMap.getState().requestFitChanges(); useFactoryMap.getState().requestFitChanges(); useFactoryMap.getState().requestFitChanges(); });
    expect(useFactoryMap.getState().changeArea).toBe(0);
    act(() => useFactoryMap.getState().setChangeAreaCount(2));
    expect(within(counts).getByTestId('timeline-to-changes')).toHaveTextContent('Go to the changes');
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
    // Without recipe data a machine has no figures for its machine window: it stays in the info window.
    const { ctx, wrap } = setup({ recipes: false });
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

describe('factory plan and the sidebar', () => {
  it('gives the Fabrikplan panel the room while the plan is on, and hands it back when it goes off', () => {
    useFactoryMap.setState({ visible: false });
    usePanelsCollapsed.setState({ solo: null, soloState: {} });
    useFactoryMap.getState().setVisible(true);
    expect(usePanelsCollapsed.getState().solo).toBe('factory-map');
    useFactoryMap.getState().toggle();
    expect(usePanelsCollapsed.getState().solo).toBeNull();
  });
});
