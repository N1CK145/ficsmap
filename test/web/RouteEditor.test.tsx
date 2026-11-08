import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getI18n } from 'react-i18next';
import type { MeDto, RouteDto, WorldDto, WorldRole } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { optimizeRoute } from '../../src/shared/route.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { routesFeature } from '../../src/web/features/routes/index.js';
import { NextStopButton } from '../../src/web/features/routes/NextStopButton.js';
import { RouteEditor } from '../../src/web/features/routes/RouteEditor.js';
import { RoutesHost } from '../../src/web/features/routes/RoutesPanel.js';
import { noticeMessage, useRouteDraft } from '../../src/web/features/routes/useRoutes.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

vi.mock('../../src/shared/route.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/shared/route.js')>();
  // Keeps the input order unless a test says otherwise.
  return { ...real, optimizeRoute: vi.fn((_start: unknown, stops: { id: string }[]) => stops.map(s => s.id)) };
});

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ROUTE_ID = '0b8e9a52-1c3d-4e5f-8a6b-7c8d9e0f1a2b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };

function world(role: WorldRole): WorldDto {
  return {
    id: W, name: 'Alpha', role, rev: 1, datasetVersion: 'test', owner: { id: role === 'owner' ? 1 : 3, displayName: 'Owner' },
    members: [
      { userId: 1, displayName: 'Nick', avatarUrl: null, joinedVia: 'invite', joinedAt: 0, role },
      { userId: 2, displayName: 'Anna', avatarUrl: null, joinedVia: 'invite', joinedAt: 0, role: 'member' },
    ],
    lastImport: null,
  };
}

const STOPS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
const dataset: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'grass-fields', name: { en: 'Grass Fields', de: 'Grass Fields' } }],
  items: [
    ['S1', 'somersloop', 0, 0, 0, 0, 1],
    ...STOPS.map((name, i): Dataset['items'][number] => [name, 'hard_drive', (i + 1) * 10_000, 0, 0, 0, i + 1]),
  ],
  aliases: {},
};

function route(over: Partial<RouteDto> = {}): RouteDto {
  return {
    id: ROUTE_ID, name: 'North sloops', startActor: 'S1', stops: STOPS, createdBy: 1, createdByName: 'Nick', createdAt: 0, updatedAt: 0, ...over,
  };
}

function marks(entries: [string, number][] = []): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map(entries.map(([a, by]) => [a, { mismatch: false, updatedBy: by, updatedAt: 0 }])),
  };
}

function setup(opts: { role?: WorldRole; route?: RouteDto; marks?: MarksCache } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const r = opts.route ?? route();
  const w = world(opts.role ?? 'member');
  const index = indexDataset(dataset);
  client.setQueryData(queryKeys.me(), ME);
  client.setQueryData(queryKeys.world(W), w);
  client.setQueryData(queryKeys.dataset('test'), index);
  client.setQueryData(queryKeys.marks(W), opts.marks ?? marks());
  client.setQueryData(queryKeys.routes(W), [r]);
  client.setQueryData(queryKeys.crashSites('test'), {});
  const ctx: WorldCtx = { worldId: W, world: w, me: ME, index, queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  return { client, ctx, route: r };
}

function renderEditor(client: QueryClient, ctx?: WorldCtx) {
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        {ctx && <RoutesHost ctx={ctx} />}
        <RouteEditor worldId={W} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const rowLabels = () => within(screen.getByRole('list', { name: 'Stops' })).getAllByRole('listitem').map(li => li.textContent ?? '');

describe('RouteEditor', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
    useRouteDraft.getState().reset();
    vi.mocked(optimizeRoute).mockClear();
  });

  it('shows the stop count against the limit', () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    renderEditor(client);
    expect(screen.getByText('7/30')).toBeInTheDocument();
    expect(screen.getByText(/North sloops/)).toBeInTheDocument();
  });

  it('leaves the pods\' "Bring with you" list to the map overlay', () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    renderEditor(client);
    expect(screen.queryByRole('region', { name: 'Bring with you' })).not.toBeInTheDocument();
  });

  it('hides Edit, Save and Delete from a member who did not create the route', () => {
    const { client, route: r } = setup({ role: 'member', route: route({ createdBy: 2, createdByName: 'Anna' }) });
    useRouteDraft.getState().load(r);
    renderEditor(client);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next stop ›' })).toBeInTheDocument();
  });

  it('shows Delete to the creator and to the owner', () => {
    const creator = setup();
    useRouteDraft.getState().load(creator.route);
    renderEditor(creator.client);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it("shows Delete to an admin for another member's route", () => {
    const { client, route: r } = setup({ role: 'admin', route: route({ createdBy: 2, createdByName: 'Anna' }) });
    useRouteDraft.getState().load(r);
    renderEditor(client);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('reorders the rows with [Optimize order]', async () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    act(() => { useUiStore.getState().setMode('route'); });
    renderEditor(client);
    expect(rowLabels()[0]).toContain('Grass Fields\u00a01');
    vi.mocked(optimizeRoute).mockReturnValueOnce([...STOPS].reverse());
    await userEvent.click(screen.getByRole('button', { name: 'Optimize order' }));
    expect(optimizeRoute).toHaveBeenCalledOnce();
    expect(rowLabels()[0]).toContain('Grass Fields\u00a07');
    expect(rowLabels()[6]).toContain('Grass Fields\u00a01');
  });

  it('drags a row onto another; dragstart sets text/plain data so Firefox starts the drag', () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    act(() => { useUiStore.getState().setMode('route'); });
    renderEditor(client);
    const rows = within(screen.getByRole('list', { name: 'Stops' })).getAllByRole('listitem');
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'uninitialized', dropEffect: 'none' };
    fireEvent.dragStart(rows[0]!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'A1');
    expect(dataTransfer.effectAllowed).toBe('move');
    fireEvent.dragOver(rows[2]!, { dataTransfer });
    fireEvent.drop(rows[2]!, { dataTransfer });
    expect(rowLabels()[0]).toContain('Grass Fields\u00a02');
    expect(rowLabels()[2]).toContain('Grass Fields\u00a01');
  });

  it('moves a focused row with Alt+↓ and then offers to optimise again', async () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    act(() => { useUiStore.getState().setMode('route'); });
    renderEditor(client);
    const first = within(screen.getByRole('list', { name: 'Stops' })).getAllByRole('listitem')[0]!;
    first.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(rowLabels()[0]).toContain('Grass Fields\u00a02');
    expect(rowLabels()[1]).toContain('Grass Fields\u00a01');
    expect(screen.getByText(/Order changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Optimize again' })).toBeInTheDocument();
  });

  it('crosses out a stop a teammate checked, with their name, and offers to re-plan', () => {
    const { client, route: r } = setup({ marks: marks([['A3', 2]]) });
    useRouteDraft.getState().load(r);
    renderEditor(client);
    expect(rowLabels()[2]).toContain('(Anna)');
    expect(screen.getByRole('button', { name: /1 stop done by others · Re-plan/ })).toBeInTheDocument();
    expect(screen.getByText(/1\/7 done/)).toBeInTheDocument();
  });

  it('shows the straight-line hint until it is dismissed', async () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    renderEditor(client);
    expect(screen.getByText('Straight-line distances, terrain not included')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Straight-line distances, terrain not included')).not.toBeInTheDocument();
    expect(localStorage.getItem('ficsmap:routeHintDismissed')).toBe('1');
  });

  it('asks before leaving route mode with unsaved changes', async () => {
    const { client, ctx, route: r } = setup();
    useRouteDraft.getState().load(r);
    act(() => { useUiStore.getState().setMode('route'); });
    renderEditor(client, ctx);
    await userEvent.click(within(screen.getByRole('list', { name: 'Stops' })).getAllByRole('button', { name: 'Remove stop' })[0]!);
    act(() => { useUiStore.getState().setMode('inspect'); });
    expect(useUiStore.getState().interactionMode).toBe('route');
    expect(screen.getByText('Discard unsaved route changes?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    expect(useRouteDraft.getState().draft?.stops).toEqual(STOPS);
  });
});

describe('RouteEditor on mobile', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
    useRouteDraft.getState().reset();
    stubMatchMedia({ [MOBILE]: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists what the open pods of the route need, without checked ones', () => {
    const { client, route: r } = setup({ marks: marks([['A1', 1], ['A2', 1]]) });
    useRouteDraft.getState().load(r);
    renderEditor(client);
    // The fixture pods have no requirement data: 7 stops, 2 checked.
    expect(screen.getByRole('region', { name: 'Bring with you' })).toHaveTextContent('5 pods without requirement data');
  });

  it('reorders with ▲/▼ buttons per row instead of dragging', async () => {
    const { client, route: r } = setup();
    useRouteDraft.getState().load(r);
    act(() => { useUiStore.getState().setMode('route'); });
    renderEditor(client);
    const rows = within(screen.getByRole('list', { name: 'Stops' })).getAllByRole('listitem');
    expect(rows[0]).not.toHaveAttribute('draggable', 'true');
    expect(within(rows[0]!).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(rows[6]!).getByRole('button', { name: 'Move down' })).toBeDisabled();
    for (const name of ['Move up', 'Move down', 'Remove stop']) expect(within(rows[1]!).getByRole('button', { name })).toHaveClass('size-11');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Move down' }));
    expect(rowLabels()[0]).toContain('Grass Fields\u00a02');
    expect(rowLabels()[1]).toContain('Grass Fields\u00a01');
    await userEvent.click(within(within(screen.getByRole('list', { name: 'Stops' })).getAllByRole('listitem')[1]!).getByRole('button', { name: 'Move up' }));
    expect(rowLabels()[0]).toContain('Grass Fields\u00a01');
  });

  it('leaves [Next stop ›] to the sticky button at the bottom of the sheet', async () => {
    const { client, route: r } = setup({ marks: marks([['A1', 1]]) });
    useRouteDraft.getState().load(r);
    render(
      <QueryClientProvider client={client}>
        <ToastProvider><RouteEditor worldId={W} /><NextStopButton worldId={W} /></ToastProvider>
      </QueryClientProvider>,
    );
    const next = screen.getAllByRole('button', { name: 'Next stop ›' });
    expect(next).toHaveLength(1);
    await userEvent.click(next[0]!);
    expect(useUiStore.getState().selectedActor).toBe('A2');
    expect(useRouteDraft.getState().focus?.actor).toBe('A2');
  });
});

describe('route map mode', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    useUiStore.getState().enterWorld(W);
    useRouteDraft.getState().reset();
  });

  it('sets the start on the first marker click and adds a stop on the next', () => {
    const { ctx } = setup();
    const mode = routesFeature.mapModes!.find(m => m.id === 'route')!;
    mode.onMarkerClick(ctx.index.byName.get('S1')!, ctx);
    mode.onMarkerClick(ctx.index.byName.get('A2')!, ctx);
    const { draft } = useRouteDraft.getState();
    expect(draft).toMatchObject({ id: null, name: 'Route 2', start: 'S1', stops: ['A2'] });
  });

  it('optimises after a change unless the order is manual', () => {
    const { ctx } = setup();
    const env = { index: ctx.index, toast: ctx.toast, t: getI18n().t };
    useRouteDraft.getState().newDraft('Route 2');
    useRouteDraft.getState().apply({ type: 'add', actors: ['S1', 'A1', 'A2'] }, env);
    vi.mocked(optimizeRoute).mockReturnValueOnce(['A3', 'A2', 'A1']);
    useRouteDraft.getState().apply({ type: 'click', actor: 'A3' }, env);
    expect(useRouteDraft.getState().draft?.stops).toEqual(['A3', 'A2', 'A1']);

    useRouteDraft.getState().apply({ type: 'move', from: 0, to: 2 }, env);
    vi.mocked(optimizeRoute).mockClear();
    useRouteDraft.getState().apply({ type: 'click', actor: 'A4' }, env);
    expect(optimizeRoute).not.toHaveBeenCalled();
    expect(useRouteDraft.getState().draft?.stops).toEqual(['A2', 'A1', 'A3', 'A4']);
  });

  it('drops stops that are no longer on the map, with a toast', () => {
    const { ctx } = setup();
    const show = vi.fn();
    useRouteDraft.getState().load(route({ stops: ['A1', 'GONE'] }));
    useRouteDraft.getState().beginEdit({ index: ctx.index, toast: { show }, t: getI18n().t });
    expect(useRouteDraft.getState().draft?.stops).toEqual(['A1']);
    expect(show).toHaveBeenCalledWith({ message: '1 stop is no longer on the map and was removed' });
    expect(useUiStore.getState().interactionMode).toBe('route');
  });
});

describe('noticeMessage', () => {
  beforeAll(() => { initI18n(['en']); });

  it('uses the spec copy for a full route and a cut bulk add', () => {
    const { t } = getI18n();
    expect(noticeMessage({ kind: 'full' }, t)).toBe('Route is full (30). Remove a stop to add another.');
    expect(noticeMessage({ kind: 'partial', added: 12, requested: 40 }, t)).toBe('Added 12 of 40 (route limit 30). Nearest first.');
  });
});
