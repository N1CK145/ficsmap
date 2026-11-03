import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import type { ReactNode } from 'react';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { worldToLatLng } from '../../src/shared/geo.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider, type ToastInput } from '../../src/web/components/Toast.js';
import { itemPanelFeature } from '../../src/web/features/itemPanel/index.js';
import { ItemPanel } from '../../src/web/features/itemPanel/ItemPanel.js';
import { MapView } from '../../src/web/features/map/MapView.js';
import { marksFeature } from '../../src/web/features/marks/index.js';
import { AccountMenu } from '../../src/web/features/worlds/AccountMenu.js';
import type { MarkState, MarksCache } from '../../src/web/features/marks/useMarks.js';
import { ItemSheet } from '../../src/web/features/mobile/ItemSheet.js';
import { useRouteDraft } from '../../src/web/features/routes/useRoutes.js';
import { stubFetch } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' },
  members: [{ userId: 2, displayName: 'Anna', avatarUrl: null, joinedVia: 'invite', joinedAt: 0 }], lastImport: null,
};

function dataset(podRequirementsKnown = true): Dataset {
  return {
    version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown,
    biomes: [{ id: 'grass-fields', name: { en: 'Grass Fields', de: 'Grass Fields' } }],
    items: [
      ['S1', 'somersloop', 1000, 1000, 500, 0, 12],
      ['P1', 'hard_drive', 5000, 1000, 500, 0, 4, { pod: { item: { en: 'Motor', de: 'Motor' }, amount: 5, power: 20 } }],
      ['P2', 'hard_drive', 1000, 5000, 500, 0, 5, { pod: { item: null, amount: 0, power: 0 } }],
      ['P3', 'hard_drive', 9000, 9000, 500, 0, 6],
      ['B1', 'slug_blue', 1000, 2000, -1300, 0, 1, { shards: 1 }],
      ['F1', 'mercer_sphere', 90_000, 90_000, 0, 0, 1],
    ],
    aliases: {},
  };
}

function marksCache(entries: [string, Partial<MarkState>][] = []): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map(entries.map(([a, m]) => [a, { mismatch: false, updatedBy: 1, updatedAt: Date.now(), ...m }])),
  };
}

function renderPanel(selected: string, opts: { marks?: MarksCache; podRequirementsKnown?: boolean; extra?: ReactNode; sheet?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.me(), ME);
  client.setQueryData(queryKeys.marks(W), opts.marks ?? marksCache());
  const index = indexDataset(dataset(opts.podRequirementsKnown));
  client.setQueryData(queryKeys.dataset('test'), index);
  const toasts: ToastInput[] = [];
  const ctx: WorldCtx = {
    worldId: W, world: WORLD, me: ME, index, queryClient: client,
    navigate: () => {}, toast: { show: t => { toasts.push(t); } },
  };
  useUiStore.getState().select(selected);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <FeaturesProvider features={[marksFeature, itemPanelFeature]}>{opts.extra}{opts.sheet ? <ItemSheet ctx={ctx} /> : <ItemPanel ctx={ctx} />}</FeaturesProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, toasts };
}

const panel = () => screen.getByRole('complementary', { name: 'Item details' });

describe('ItemPanel', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUiStore.getState().enterWorld(W); });
  afterEach(() => vi.unstubAllGlobals());

  it('is not rendered without a selection', () => {
    renderPanel('S1');
    act(() => { useUiStore.getState().select(null); });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('shows type, biome and number in the header', () => {
    renderPanel('S1');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Somersloop' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('Grass Fields 12');
  });

  it('shows Keep checked and Uncheck for a conflict, and Uncheck sets the mark to false', async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/S1`]: { body: { rev: 2 } } });
    renderPanel('S1', { marks: marksCache([['S1', { mismatch: true }]]) });
    expect(panel()).toHaveTextContent('Save says this is still there.');
    expect(screen.getByRole('button', { name: 'Keep checked' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Uncheck' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/marks/S1`, body: { collected: false } }));
  });

  it('checks an unchecked item with the primary button', async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/S1`]: { body: { rev: 2 } } });
    renderPanel('S1');
    expect(screen.queryByText('Save says this is still there.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/marks/S1`, body: { collected: true } }));
  });

  it('names who changed a checked item last', () => {
    renderPanel('S1', { marks: marksCache([['S1', { updatedBy: 2, updatedAt: Date.now() - 2 * 3_600_000 }]]) });
    expect(screen.getByRole('button', { name: 'Uncheck' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('Last changed by Anna · 2 hours ago');
  });

  it('says "someone" for an unknown user', () => {
    renderPanel('S1', { marks: marksCache([['S1', { updatedBy: 99 }]]) });
    expect(panel()).toHaveTextContent(/Last changed by someone/);
  });

  it('shows the crash site: items with location hints, threats and notes', async () => {
    stubFetch({
      'GET /data/test/crash-sites.json': { body: { P1: {
        items: [{ item: 'Steel Pipe', amount: 98, where: 'lower level' }, { item: 'Stator', amount: 37 }],
        threats: [{ name: 'Hatcher', count: 2 }, { name: 'Gas Pillar', count: null }],
        notes: ['Bring a gas mask.'],
      } } },
    });
    renderPanel('P1');
    const section = await within(panel()).findByRole('region', { name: 'Crash site' });
    expect(section).toHaveTextContent('Steel Pipe · lower level98×');
    expect(section).toHaveTextContent('Stator37×');
    expect(section).toHaveTextContent('2× Hatcher');
    expect(section).toHaveTextContent('Gas Pillar');
    expect(section).toHaveTextContent('Bring a gas mask.');
  });

  it('has no crash-site section for a pod without data, or when the dataset has no crash-sites file', async () => {
    stubFetch({ 'GET /data/test/crash-sites.json': { status: 404, body: { error: 'not_found', message: 'x' } } });
    renderPanel('P2');
    await waitFor(() => expect(within(panel()).getByRole('region', { name: 'To open' })).toBeInTheDocument());
    expect(within(panel()).queryByRole('region', { name: 'Crash site' })).not.toBeInTheDocument();
  });

  it('shows a pod requirement, "Nothing needed" and missing data', () => {
    renderPanel('P1');
    expect(panel()).toHaveTextContent('5× Motor · 20 MW');
    act(() => { useUiStore.getState().select('P2'); });
    expect(panel()).toHaveTextContent('Nothing needed');
    act(() => { useUiStore.getState().select('P3'); });
    expect(panel()).toHaveTextContent('No requirement data for this pod');
  });

  it('says "Requirements vary per world" when pod requirements are not known', () => {
    renderPanel('P1', { podRequirementsKnown: false });
    expect(panel()).toHaveTextContent('Requirements vary per world');
    expect(panel()).not.toHaveTextContent('Motor');
  });

  it('shows the power shard yield for slugs only', () => {
    renderPanel('B1');
    expect(panel()).toHaveTextContent('Yields 1 power shard');
    act(() => { useUiStore.getState().select('S1'); });
    expect(panel()).not.toHaveTextContent('power shard');
  });

  it('lists nearby items with distance, height and status; a row selects its item', async () => {
    renderPanel('S1', { marks: marksCache([['B1', {}]]) });
    const nearby = screen.getByRole('region', { name: /Nearby/ });
    const slug = within(nearby).getByRole('button', { name: /Blue Power Slug · Grass Fields 1/ });
    expect(slug).toHaveTextContent('21 m');
    expect(slug).toHaveTextContent('18 m below');
    expect(slug).toHaveTextContent('Collected');
    expect(within(nearby).queryByRole('button', { name: /Mercer Sphere/ })).not.toBeInTheDocument();
    await userEvent.click(slug);
    expect(useUiStore.getState().selectedActor).toBe('B1');
  });

  it('shows the coordinates in metres and copies the actor name', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { toasts } = renderPanel('P1');
    expect(panel()).toHaveTextContent('X 50 · Y 10 · Z 5');
    expect(within(panel()).getByText('P1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    expect(writeText).toHaveBeenCalledWith('P1');
    await waitFor(() => expect(toasts).toContainEqual({ message: 'Copied' }));
  });

  it('closes on Esc and with the × button', async () => {
    renderPanel('S1');
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().selectedActor).toBeNull();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    act(() => { useUiStore.getState().select('S1'); });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('ignores Esc while a modal dialog is open', async () => {
    renderPanel('S1');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    try {
      await userEvent.keyboard('{Escape}');
      expect(useUiStore.getState().selectedActor).toBe('S1');
    } finally {
      dialog.remove();
    }
  });

  it('does not close on the Esc that closes the account menu', async () => {
    renderPanel('S1', { extra: <AccountMenu /> });
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(useUiStore.getState().selectedActor).toBe('S1');
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().selectedActor).toBeNull();
  });

  it('keeps the panel open on Esc in quick mode (Esc leaves the mode there)', async () => {
    renderPanel('S1');
    act(() => { useUiStore.getState().setMode('quick'); });
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().selectedActor).toBe('S1');
  });
});

describe('ItemSheet (mobile)', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    useUiStore.getState().enterWorld(W);
    stubMatchMedia({ [MOBILE]: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the item in a half-height sheet with a 56 px full-width Check button', async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/S1`]: { body: { rev: 2 } } });
    renderPanel('S1', { sheet: true });
    const sheet = panel();
    expect(sheet).toHaveClass('h-[50dvh]');
    expect(within(sheet).getByRole('heading', { level: 2, name: 'Somersloop' })).toBeInTheDocument();
    const check = within(sheet).getByRole('button', { name: 'Check' });
    expect(check).toHaveClass('h-14', 'w-full');
    await userEvent.click(check);
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/marks/S1`, body: { collected: true } }));
  });

  it('shows [Next stop ›] at its bottom while the open route has an open stop, since it covers the panels sheet', async () => {
    useRouteDraft.getState().load({
      id: '0b8e9a52-1c3d-4e5f-8a6b-7c8d9e0f1a2b', name: 'R', startActor: 'S1', stops: ['P1', 'P2'],
      createdBy: 1, createdByName: 'Nick', createdAt: 0, updatedAt: 0,
    });
    try {
      renderPanel('P1', { sheet: true, marks: marksCache([['P1', {}]]) });
      const next = within(panel()).getByRole('button', { name: 'Next stop ›' });
      await userEvent.click(next);
      expect(useUiStore.getState().selectedActor).toBe('P2');
      expect(useRouteDraft.getState().focus?.actor).toBe('P2');
      // Route closed: no button.
      act(() => { useRouteDraft.getState().reset(); });
      expect(within(panel()).queryByRole('button', { name: 'Next stop ›' })).not.toBeInTheDocument();
    } finally {
      useRouteDraft.getState().reset();
    }
  });

  it('has no [Next stop ›] without an open route', () => {
    renderPanel('S1', { sheet: true });
    expect(within(panel()).queryByRole('button', { name: 'Next stop ›' })).not.toBeInTheDocument();
  });

  it('closes on Esc and with ×', async () => {
    renderPanel('S1', { sheet: true });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Item details' })).not.toBeInTheDocument();
    act(() => { useUiStore.getState().select('S1'); });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Item details' })).not.toBeInTheDocument();
  });
});

describe('SelectionPan', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUiStore.getState().enterWorld(W); });
  afterEach(() => vi.restoreAllMocks());

  it('pans a newly selected marker out from under the panel', () => {
    const panInside = vi.spyOn(L.Map.prototype, 'panInside');
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(queryKeys.marks(W), marksCache());
    const index = indexDataset(dataset());
    const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
    render(
      <QueryClientProvider client={client}>
        <FeaturesProvider features={[itemPanelFeature]}><MapView ctx={ctx} /></FeaturesProvider>
      </QueryClientProvider>,
    );
    expect(panInside).not.toHaveBeenCalled();
    act(() => { useUiStore.getState().select('P1'); });
    expect(panInside).toHaveBeenCalledWith(
      worldToLatLng(5000, 1000, index.ds.bounds),
      expect.objectContaining({ paddingTopLeft: [0, 0], paddingBottomRight: [360, 0] }),
    );
  });

  it('on mobile pans the marker out from under the item sheet (bottom half) instead', () => {
    stubMatchMedia({ [MOBILE]: true });
    // A fresh point each call: Leaflet mutates the one it gets.
    vi.spyOn(L.Map.prototype, 'getSize').mockImplementation(() => L.point(390, 700));
    const panInside = vi.spyOn(L.Map.prototype, 'panInside');
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(queryKeys.marks(W), marksCache());
    const index = indexDataset(dataset());
    const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
    render(
      <QueryClientProvider client={client}>
        <FeaturesProvider features={[itemPanelFeature]}><MapView ctx={ctx} /></FeaturesProvider>
      </QueryClientProvider>,
    );
    act(() => { useUiStore.getState().select('P1'); });
    expect(panInside).toHaveBeenCalledWith(
      worldToLatLng(5000, 1000, index.ds.bounds),
      expect.objectContaining({ paddingTopLeft: [0, 0], paddingBottomRight: [0, 350] }),
    );
    vi.unstubAllGlobals();
  });
});
