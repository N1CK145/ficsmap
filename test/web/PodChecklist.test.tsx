import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, RouteDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type CrashSites, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { PodChecklist } from '../../src/web/features/routes/PodChecklist.js';
import { fitOverlay, HEADER_H, MIN_OPEN, PodChecklistOverlay } from '../../src/web/features/routes/PodChecklistOverlay.js';
import { useRouteDraft } from '../../src/web/features/routes/useRoutes.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ROUTE_ID = '0b8e9a52-1c3d-4e5f-8a6b-7c8d9e0f1a2b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' },
  members: [{ userId: 1, displayName: 'Nick', avatarUrl: null, joinedVia: 'invite', joinedAt: 0, role: 'member' }], lastImport: null,
};

const req = (item: string, amount: number, power = 0) => ({ pod: { item: { en: item, de: item }, amount, power } });
const dataset: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'grass-fields', name: { en: 'Grass Fields', de: 'Grass Fields' } }],
  items: [
    ['S1', 'somersloop', 0, 0, 0, 0, 1],
    ['P1', 'hard_drive', 10_000, 0, 0, 0, 1, req('Rotor', 10)],
    ['P2', 'hard_drive', 20_000, 0, 0, 0, 2, req('Motor', 4)],
    ['P3', 'hard_drive', 30_000, 0, 0, 0, 3, req('Wire', 5)],
  ],
  aliases: {},
};
// Rotor: 6 at P1's own site, the rest to bring; Wire: all at P2, on the way to P3.
const SITES: CrashSites = {
  P1: { items: [{ item: 'Rotor', amount: 6 }], threats: [], notes: [] },
  P2: { items: [{ item: 'Wire', amount: 20 }], threats: [], notes: [] },
};

const route = (over: Partial<RouteDto> = {}): RouteDto => ({
  id: ROUTE_ID, name: 'Pods', startActor: 'S1', stops: ['P1', 'P2', 'P3'], createdBy: 1, createdByName: 'Nick', createdAt: 0, updatedAt: 0, ...over,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const index = indexDataset(dataset);
  client.setQueryData(queryKeys.me(), ME);
  client.setQueryData(queryKeys.world(W), WORLD);
  client.setQueryData(queryKeys.dataset('test'), index);
  client.setQueryData(queryKeys.marks(W), { rev: 1, baseRev: 1, revs: new Map(), pending: new Map(), marks: new Map() });
  client.setQueryData(queryKeys.routes(W), [route()]);
  client.setQueryData(queryKeys.crashSites('test'), SITES);
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const ui = (node: React.ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  return { ctx, ui };
}

const overlay = () => screen.getByRole('complementary', { name: 'Bring with you' });

describe('fitOverlay', () => {
  it('puts no limit on it before layout', () => {
    expect(fitOverlay(null, null)).toEqual({ fits: true, maxHeight: Infinity, beside: false });
    expect(fitOverlay(0, 100)).toEqual({ fits: true, maxHeight: Infinity, beside: false });
  });

  it('takes the room under the item panel and collapses when it is too little', () => {
    expect(fitOverlay(800, null)).toMatchObject({ fits: true, beside: false });
    expect(fitOverlay(800, 300).fits).toBe(true);
    const tight = fitOverlay(800, 800 - 24 - 8 - MIN_OPEN + 1);
    expect(tight.fits).toBe(false);
    expect(tight.beside).toBe(false);
  });

  it('moves the collapsed header beside a panel that leaves no room at all', () => {
    expect(fitOverlay(800, 790)).toEqual({ fits: false, maxHeight: HEADER_H, beside: true });
  });
});

describe('PodChecklistOverlay', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
    useRouteDraft.getState().reset();
    stubMatchMedia();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows nothing without an open route', () => {
    const { ctx, ui } = setup();
    render(ui(<PodChecklistOverlay ctx={ctx} />));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('lists what to bring, what lies on the way, and where', () => {
    const { ctx, ui } = setup();
    useRouteDraft.getState().load(route());
    render(ui(<PodChecklistOverlay ctx={ctx} />));
    const box = overlay();
    expect(box).toHaveTextContent('2 open');
    const motor = within(box).getByRole('checkbox', { name: /Motor/ }).closest('li')!;
    expect(motor).toHaveTextContent('Motor4×');
    const rotor = within(box).getByRole('checkbox', { name: /Rotor/ }).closest('li')!;
    expect(rotor).toHaveTextContent('Rotor4×+6 at stop 1');
    const found = within(box).getByRole('region', { name: 'Found on the way' });
    expect(found).toHaveTextContent('Wire5×stop 2');
    expect(within(box).queryByRole('checkbox', { name: /Wire/ })).not.toBeInTheDocument();
  });

  it('ticks items off, remembered per route on this device', async () => {
    const user = userEvent.setup();
    const { ctx, ui } = setup();
    useRouteDraft.getState().load(route());
    const { unmount } = render(ui(<PodChecklistOverlay ctx={ctx} />));
    await user.click(within(overlay()).getByRole('checkbox', { name: /Motor/ }));
    expect(overlay()).toHaveTextContent('1 open');
    unmount();
    render(ui(<PodChecklistOverlay ctx={ctx} />));
    expect(within(overlay()).getByRole('checkbox', { name: /Motor/ })).toBeChecked();
    expect(within(overlay()).getByRole('checkbox', { name: /Rotor/ })).not.toBeChecked();
  });

  it('carries the ticks of an unsaved route over when it is saved', async () => {
    const user = userEvent.setup();
    const { ctx, ui } = setup();
    useRouteDraft.getState().load(route());
    useRouteDraft.setState(s => ({ draft: s.draft && { ...s.draft, id: null } }));
    render(ui(<PodChecklistOverlay ctx={ctx} />));
    await user.click(within(overlay()).getByRole('checkbox', { name: /Motor/ }));
    expect(localStorage.length).toBe(0);
    act(() => { useRouteDraft.getState().load(route()); });
    expect(within(overlay()).getByRole('checkbox', { name: /Motor/ })).toBeChecked();
    expect(localStorage.getItem(`ficsmap:podTicks:${W}:${ROUTE_ID}`)).toBe('["Motor"]');
  });

  it('collapses to its header by hand, remembered', async () => {
    const user = userEvent.setup();
    const { ctx, ui } = setup();
    useRouteDraft.getState().load(route());
    const { unmount } = render(ui(<PodChecklistOverlay ctx={ctx} />));
    await user.click(within(overlay()).getByRole('button', { name: 'Collapse list' }));
    expect(within(overlay()).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(overlay()).toHaveTextContent('2 open');
    unmount();
    render(ui(<PodChecklistOverlay ctx={ctx} />));
    await user.click(within(overlay()).getByRole('button', { name: 'Expand list' }));
    expect(within(overlay()).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('is not shown on mobile, where the route editor holds the list', () => {
    stubMatchMedia({ [MOBILE]: true });
    const { ctx, ui } = setup();
    useRouteDraft.getState().load(route());
    render(ui(<><PodChecklistOverlay ctx={ctx} /><PodChecklist worldId={W} /></>));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bring with you' })).toHaveTextContent('2 open');
  });
});
