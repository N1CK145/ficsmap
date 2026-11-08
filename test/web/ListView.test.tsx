import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { collect } from '../../src/web/app/feature.js';
import { FEATURES } from '../../src/web/features/index.js';
import { ListView } from '../../src/web/features/listView/ListView.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const dataset: Dataset = {
  version: 'v1', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'grass', name: { en: 'Grass Fields', de: 'Grasfelder' } }, { id: 'swamp', name: { en: 'Swamp', de: 'Sumpf' } }],
  items: [
    ['S1', 'somersloop', 1, 1, 0, 0, 1], ['S2', 'somersloop', 2, 2, 0, 0, 2],
    ['M1', 'mercer_sphere', 4, 4, 0, 1, 1], ['H1', 'hard_drive', 5, 5, 0, 1, 1],
  ],
  aliases: {},
};
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' },
  members: [{ userId: 2, displayName: 'Anna', avatarUrl: null, joinedVia: 'invite', joinedAt: 0, role: 'member' }], lastImport: null,
};

function marks(entries: Record<string, { mismatch?: boolean; by?: number }>): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map(Object.entries(entries).map(([a, e]) => [a, { mismatch: e.mismatch ?? false, updatedBy: e.by ?? 2, updatedAt: 0 }])),
  };
}

function renderList(m: MarksCache) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const index = indexDataset(dataset);
  client.setQueryData(queryKeys.marks(W), m);
  const ctx = { worldId: W, world: WORLD, me: { id: 1 } as MeDto, index, queryClient: client } as unknown as WorldCtx;
  render(<QueryClientProvider client={client}><ToastProvider><ListView ctx={ctx} /></ToastProvider></QueryClientProvider>);
}

const cell = (row: HTMLElement, i: number) => within(row).getAllByRole('cell')[i];

describe('ListView', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUiStore.getState().enterWorld(W); });
  afterEach(() => vi.unstubAllGlobals());

  it('is a table with a caption, headers and a checkbox named like the item label', () => {
    renderList(marks({ S1: {} }));
    expect(screen.getByRole('table', { name: 'Collectibles' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Type', 'Item', 'Biome', 'Status', 'Last changed by', 'Show on map']);
    const box = screen.getByRole('checkbox', { name: 'Somersloop · Grass Fields\u00a01' });
    expect(box).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Somersloop · Grass Fields\u00a02' })).not.toBeChecked();
    const row = box.closest('tr') as HTMLElement;
    expect(cell(row, 2)).toHaveTextContent('Grass Fields');
    expect(cell(row, 4)).toHaveTextContent('Anna');
    expect(cell(screen.getByRole('checkbox', { name: 'Somersloop · Grass Fields\u00a02' }).closest('tr') as HTMLElement, 4)).toHaveTextContent('—');
  });

  it('toggling the checkbox sets the mark', async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/S2`]: { body: { rev: 2 } } });
    renderList(marks({}));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Somersloop · Grass Fields\u00a02' }));
    expect(calls).toContainEqual({ method: 'PUT', path: `/api/worlds/${W}/marks/S2`, body: { collected: true } });
  });

  it('marks a conflict with "!" and a screen reader text', () => {
    renderList(marks({ S1: { mismatch: true } }));
    const row = screen.getByRole('checkbox', { name: 'Somersloop · Grass Fields\u00a01' }).closest('tr') as HTMLElement;
    expect(cell(row, 3)).toHaveTextContent('!');
    expect(within(row).getByText('Conflict')).toHaveClass('sr-only');
  });

  it('respects type filter, biome scope, visibility and only-conflicts', () => {
    renderList(marks({ S1: {}, S2: { mismatch: true } }));
    const labels = () => screen.getAllByRole('checkbox').map(b => b.getAttribute('aria-label'));
    expect(labels()).toHaveLength(4);

    const ui = useUiStore;
    act(() => ui.getState().showOnlyType('somersloop'));
    expect(labels()).toEqual(['Somersloop · Grass Fields\u00a01', 'Somersloop · Grass Fields\u00a02']);
    act(() => ui.getState().setVisibility('hide')); // collected S1 hidden, conflict S2 stays
    expect(labels()).toEqual(['Somersloop · Grass Fields\u00a02']);
    act(() => { ui.getState().setVisibility('dim'); ui.getState().setTypeFilter(['somersloop', 'mercer_sphere', 'hard_drive']); ui.getState().setBiomeScope(1); });
    expect(labels()).toEqual(['Mercer Sphere · Swamp\u00a01', 'Hard Drive · Swamp\u00a01']);
    act(() => { ui.getState().setBiomeScope(null); ui.getState().setOnlyConflicts(true); });
    expect(labels()).toEqual(['Somersloop · Grass Fields\u00a02']);
  });

  it('Show on map switches the main view and selects the item', async () => {
    renderList(marks({}));
    const row = screen.getByRole('checkbox', { name: 'Mercer Sphere · Swamp\u00a01' }).closest('tr') as HTMLElement;
    useUiStore.getState().setMainView('list');
    await userEvent.click(within(row).getByRole('button', { name: /^Show on map/ }));
    expect(useUiStore.getState().mainView).toBe('map');
    expect(useUiStore.getState().selectedActor).toBe('M1');
  });

  it('puts the Map | List switch first in the sidebar', () => {
    expect(collect(FEATURES, 'sidebarPanels')[0]?.id).toBe('view');
  });

  it('Show on map asks the map to focus the item', async () => {
    renderList(marks({}));
    await userEvent.click(within(screen.getByRole('checkbox', { name: 'Mercer Sphere · Swamp\u00a01' }).closest('tr') as HTMLElement).getByRole('button', { name: /^Show on map/ }));
    expect(useUiStore.getState().focusRequest?.actor).toBe('M1');
  });
});
