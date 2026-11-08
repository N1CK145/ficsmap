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
import { FactoryPanel } from '../../src/web/features/factory/map/FactoryPanel.js';
import { HighlightChip } from '../../src/web/features/factory/map/HighlightChip.js';
import { DEFAULT_VIEW, HEIGHT_KEY, loadHeights, useFactoryMap } from '../../src/web/features/factory/map/useFactoryMap.js';
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
    Build_Foundation_8x4_01_C: {
      name: { en: 'Foundation', de: 'Fundament' }, category: 'structure', size: { w: 800, d: 800, h: 400 },
      footprint: { source: 'clearance', boxes: [{ min: [-400, -400, -200], max: [400, 400, 200], soft: true }] },
    },
  },
};
const ctor = (id: string, z: number): SnapshotBuilding => ({ id, cls: 'Build_ConstructorMk1_C', x: 10_000, y: 10_000, z, yaw: 0, prod: { clock: 1, productivity: 1 } });
/** Foundations whose top is at `top` cm. */
const foundations = (top: number, n: number): number[] => Array.from({ length: n }, (_, i) => [i * 800, 20_000, top - 200, 0]).flat();

/** Three floors: the ground (0 m), 12 m and 24 m, a constructor on each. */
const snap = (saveTime: number, sessionName = 'Alpha', levels = [0, 1200, 2400]): FactorySnapshot => ({
  v: 1, meta: { sessionName, saveTime, build: 1 },
  buildings: levels.map((z, i) => ctor(`m${i}`, z)),
  lightweight: [{ cls: 'Build_Foundation_8x4_01_C', xyzYaw: levels.flatMap(z => foundations(z, 12)) }],
  splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
});
const S2 = snap(Date.UTC(2026, 10, 7, 23));
/** An older save with only the ground floor. */
const S1 = snap(Date.UTC(2026, 10, 2, 21), 'Alpha', [0]);

function setup(list = [makeSummary(2, S2.meta.saveTime, 'Alpha'), makeSummary(1, S1.meta.saveTime, 'Alpha')]) {
  stubFetch({
    'GET /api/me': { body: ME },
    [`GET /api/worlds/${W}`]: { body: WORLD },
    [`GET /api/worlds/${W}/snapshots`]: { body: list },
    [`GET /api/worlds/${W}/snapshots/1`]: { body: S1 },
    [`GET /api/worlds/${W}/snapshots/2`]: { body: S2 },
    'GET /data/test/buildings.json': { body: BUILDINGS },
    'GET /data/test/collectibles.min.json': { body: DS },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const wrap = (node: ReactNode) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ctx, wrap };
}

beforeEach(() => {
  initI18n(['en']);
  localStorage.clear();
  useFactoryView.getState().reset();
  useFactoryMap.setState({ ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers }, visible: true, heights: {}, selection: null, fittedSeq: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('factory map: height range', () => {
  it('offers two labelled handles over the save\'s heights; keys move them metre by metre and floor to floor', async () => {
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    const group = await screen.findByRole('group', { name: 'Height' });
    expect(group).toHaveTextContent('all heights');
    const lower = within(group).getByRole('slider', { name: 'Lower height limit' });
    const upper = within(group).getByRole('slider', { name: 'Upper height limit' });
    expect(lower).toHaveAttribute('aria-valuetext', 'from 0 m');
    expect(upper).toHaveAttribute('aria-valuetext', 'to 24 m');
    expect(within(group).getByRole('button', { name: 'All' })).toBeDisabled();

    lower.focus();
    await user.keyboard('{PageUp}');
    expect(lower).toHaveAttribute('aria-valuetext', 'from 12 m');
    expect(group).toHaveTextContent('12 m and up');
    expect(useFactoryMap.getState().heights[W]).toEqual({ lo: 12, hi: 24, session: 'Alpha' });

    upper.focus();
    await user.keyboard('{PageDown}');
    expect(upper).toHaveAttribute('aria-valuetext', 'to 23 m');
    expect(group).toHaveTextContent('12–23 m');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(upper).toHaveAttribute('aria-valuetext', 'to 21 m');
    await user.keyboard('{Home}');
    expect(upper).toHaveAttribute('aria-valuetext', 'to 12 m');
    await user.keyboard('{End}');
    expect(upper).toHaveAttribute('aria-valuetext', 'to 24 m');
    lower.focus();
    await user.keyboard('{ArrowUp}{End}');
    expect(lower).toHaveAttribute('aria-valuetext', 'from 24 m');
    await user.keyboard('{Home}');
    // Both handles at the ends again: no range.
    expect(useFactoryMap.getState().heights[W]).toBeUndefined();
    expect(group).toHaveTextContent('all heights');
  });

  it('counts the buildings in the range, offers "show what lies below" above the lowest height, and "All" resets', async () => {
    useFactoryMap.setState({ heights: { [W]: { lo: 12, hi: 23, session: 'Alpha' } } });
    const { wrap } = setup();
    const user = userEvent.setup();
    wrap(<FactoryPanel worldId={W} />);
    expect(await screen.findByTestId('height-count')).toHaveTextContent('1 of 3 buildings in this range');
    const below = screen.getByRole('checkbox', { name: 'Show what lies below faintly' });
    expect(below).toBeEnabled();
    await user.click(below);
    expect(useFactoryMap.getState().heightBelow).toBe(true);
    await user.click(within(screen.getByRole('group', { name: 'Height' })).getByRole('button', { name: 'All' }));
    expect(useFactoryMap.getState().heights[W]).toBeUndefined();
    expect(screen.getByRole('checkbox', { name: 'Show what lies below faintly' })).toBeDisabled();
  });

  it('remembers the range per world on the device', () => {
    useFactoryMap.getState().setHeight(W, { lo: 12, hi: 23 }, 'Alpha');
    useFactoryMap.getState().setHeight('other', { lo: 1, hi: 2 }, 'B');
    expect(JSON.parse(localStorage.getItem(HEIGHT_KEY)!)).toEqual({ v: 1, worlds: { [W]: { lo: 12, hi: 23, session: 'Alpha' }, other: { lo: 1, hi: 2, session: 'B' } } });
    expect(loadHeights()).toEqual({ [W]: { lo: 12, hi: 23, session: 'Alpha' }, other: { lo: 1, hi: 2, session: 'B' } });
    useFactoryMap.getState().setHeight('other', null);
    expect(loadHeights()).toEqual({ [W]: { lo: 12, hi: 23, session: 'Alpha' } });
    localStorage.setItem(HEIGHT_KEY, JSON.stringify({ v: 1, worlds: { a: { lo: 3, hi: 1, session: 'x' }, b: { lo: 'x' }, c: { lo: 1, hi: 2, session: 'S' } } }));
    expect(loadHeights()).toEqual({ c: { lo: 1, hi: 2, session: 'S' } });
    localStorage.setItem(HEIGHT_KEY, '{broken');
    expect(loadHeights()).toEqual({});
  });

  it('drops the range for a save of another session', async () => {
    useFactoryMap.setState({ heights: { [W]: { lo: 12, hi: 23, session: 'Beta' } } });
    const { wrap } = setup();
    wrap(<FactoryPanel worldId={W} />);
    await screen.findByRole('group', { name: 'Height' });
    await waitFor(() => expect(useFactoryMap.getState().heights[W]).toBeUndefined());
    expect(screen.getByRole('group', { name: 'Height' })).toHaveTextContent('all heights');
  });

  it('keeps the range while stepping the timeline as long as it still fits the save\'s heights', async () => {
    useFactoryMap.setState({ heights: { [W]: { lo: 0, hi: 11, session: 'Alpha' } } });
    const { wrap } = setup();
    wrap(<FactoryPanel worldId={W} />);
    const group = await screen.findByRole('group', { name: 'Height' });
    await waitFor(() => expect(group).toHaveTextContent('up to 11 m'));
    // The older save only has the ground floor: 0–11 m still says something there.
    act(() => useFactoryView.getState().select(1));
    await waitFor(() => expect(screen.getByTestId('factory-panel-save')).toHaveTextContent('02'));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Height' })).toBeInTheDocument());
    expect(useFactoryMap.getState().heights[W]).toEqual({ lo: 0, hi: 11, session: 'Alpha' });
    // A range above all of it does not.
    act(() => useFactoryMap.getState().setHeight(W, { lo: 12, hi: 23 }, 'Alpha'));
    await waitFor(() => expect(useFactoryMap.getState().heights[W]).toBeUndefined());
  });

  it('says how many marked buildings lie outside the range and widens it to them on "Show"', async () => {
    useFactoryMap.setState({ heights: { [W]: { lo: 12, hi: 23, session: 'Alpha' } } });
    const { ctx, wrap } = setup();
    const user = userEvent.setup();
    wrap(<HighlightChip ctx={ctx} />);
    act(() => useFactoryView.getState().showOnMap(['m0', 'm1']));
    const chip = await screen.findByTestId('factory-highlight-chip');
    const outside = await within(chip).findByTestId('factory-highlight-outside');
    expect(outside).toHaveTextContent('1 marked building lies outside the height range');
    await user.click(within(outside).getByRole('button', { name: 'Show' }));
    expect(useFactoryMap.getState().heights[W]).toEqual({ lo: 0, hi: 23, session: 'Alpha' });
    await waitFor(() => expect(within(chip).queryByTestId('factory-highlight-outside')).toBeNull());
  });
});
