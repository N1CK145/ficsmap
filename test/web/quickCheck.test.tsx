import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { saveView } from '../../src/web/app/persist.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import type { ToastInput } from '../../src/web/components/Toast.js';
import { ToastProvider } from '../../src/web/components/Toast.js';
import { MapView } from '../../src/web/features/map/MapView.js';
import { useUndoStack } from '../../src/web/features/marks/undo.js';
import { useUndoShortcut } from '../../src/web/features/marks/useUndoShortcut.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { quickCheckFeature } from '../../src/web/features/quickCheck/index.js';
import { useQuickCheckKeys } from '../../src/web/features/quickCheck/useQuickCheckKeys.js';
import { stubFetch } from './fetchStub.js';
import { MOBILE, stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const DATASET: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'swamp', name: { en: 'Swamp', de: 'Swamp' } }],
  items: [['M1', 'mercer_sphere', 10, 10, 0, 0, 1], ['C1', 'somersloop', 20, 20, 0, 0, 2]],
  aliases: {},
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.me(), ME);
  const marks: MarksCache = {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map([['C1', { mismatch: true, updatedBy: 1, updatedAt: 0 }]]),
  };
  client.setQueryData(queryKeys.marks(W), marks);
  const toasts: ToastInput[] = [];
  const ctx: WorldCtx = {
    worldId: W, world: {} as WorldDto, me: ME, index: indexDataset(DATASET), queryClient: client,
    navigate: () => {}, toast: { show: t => { toasts.push(t); } },
  };
  return { client, ctx, toasts };
}

function deferred() {
  let resolve!: (r: { body: unknown }) => void;
  const promise = new Promise<{ body: unknown }>(r => { resolve = r; });
  return { promise, resolve };
}

const quickMode = () => quickCheckFeature.mapModes!.find(m => m.id === 'quick')!;
const item = (ctx: WorldCtx, name: string) => ctx.index.byName.get(name)!;

describe('Quick Check mode', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
    useUndoStack.getState().clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('toggles a marker, toasts "<Type> checked · Undo", and Undo reverts it', async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/M1`]: { body: { rev: 2 } } });
    const { ctx, toasts } = setup();
    quickMode().onMarkerClick(item(ctx, 'M1'), ctx);
    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(calls).toEqual([{ method: 'PUT', path: `/api/worlds/${W}/marks/M1`, body: { collected: true } }]);
    expect(toasts[0]).toMatchObject({ message: 'Mercer Sphere checked', action: { label: 'Undo' } });
    expect(useUiStore.getState().selectedActor).toBeNull();

    toasts[0]!.action!.run();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ method: 'PUT', path: `/api/worlds/${W}/marks/M1`, body: { collected: false } });
    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ message: 'Undone' }));
    expect(useUndoStack.getState().stack).toEqual([]);
  });

  it('opens the panel for a conflict instead of toggling it', () => {
    const { calls } = stubFetch({});
    const { ctx, toasts } = setup();
    quickMode().onMarkerClick(item(ctx, 'C1'), ctx);
    expect(useUiStore.getState().selectedActor).toBe('C1');
    expect(calls).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('has a check-mark cursor in the theme colours', () => {
    const root = document.documentElement.style;
    root.setProperty('--color-accent', '#F28C28');
    root.setProperty('--color-bg', '#15171A');
    try {
      expect(quickMode().cursor).toContain(encodeURIComponent('#F28C28'));
      expect(quickMode().cursor).toMatch(/^url\("data:image\/svg\+xml,.+"\) \d+ \d+, pointer$/);
    } finally {
      root.removeProperty('--color-accent');
      root.removeProperty('--color-bg');
    }
  });

  it('toasts only for the latest write when answers arrive out of order', async () => {
    const replies = [deferred(), deferred()];
    let n = 0;
    stubFetch({ [`PUT /api/worlds/${W}/marks/M1`]: () => replies[n++]!.promise });
    const { ctx, toasts } = setup();
    quickMode().onMarkerClick(item(ctx, 'M1'), ctx); // checks
    quickMode().onMarkerClick(item(ctx, 'M1'), ctx); // unchecks (reads the pending value)
    await waitFor(() => expect(n).toBe(2));
    replies[1]!.resolve({ body: { rev: 3 } });
    await waitFor(() => expect(toasts).toHaveLength(1));
    replies[0]!.resolve({ body: { rev: 2 } });
    await new Promise(r => setTimeout(r, 20));
    expect(toasts.map(t => t.message)).toEqual(['Mercer Sphere unchecked']);
  });

  it("does nothing on the toast's Undo once Ctrl+Z has undone the same change", async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/M1`]: { body: { rev: 2 } } });
    const { ctx, toasts } = setup();
    render(<QueryClientProvider client={ctx.queryClient}><ToastProvider><UndoHarness ctx={ctx} /></ToastProvider></QueryClientProvider>);
    quickMode().onMarkerClick(item(ctx, 'M1'), ctx);
    await waitFor(() => expect(toasts).toHaveLength(1));
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(calls).toHaveLength(2));
    toasts[0]!.action!.run();
    await new Promise(r => setTimeout(r, 20));
    expect(calls).toHaveLength(2);
  });
});

function QuickKeys() {
  useQuickCheckKeys();
  return null;
}

function renderMap(ctx: WorldCtx, zoom: number) {
  saveView(W, { center: [-128, 128], zoom, typeFilter: ['mercer_sphere', 'somersloop'], visibility: 'dim', biomeScope: null });
  return render(
    <QueryClientProvider client={ctx.queryClient}>
      <FeaturesProvider features={[quickCheckFeature]}><QuickKeys /><MapView ctx={ctx} /></FeaturesProvider>
    </QueryClientProvider>,
  );
}

describe('Quick Check control and banner', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().enterWorld(W);
  });

  it('turns the mode on and off with the control, Q and Esc', async () => {
    const { ctx } = setup();
    renderMap(ctx, 3);
    const control = screen.getByRole('button', { name: 'Quick Check' });
    expect(control).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(control);
    expect(useUiStore.getState().interactionMode).toBe('quick');
    expect(control).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('QUICK CHECK ON · Click a marker to check it · Q to stop')).toBeInTheDocument();
    await userEvent.keyboard('q');
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    await userEvent.keyboard('Q');
    expect(useUiStore.getState().interactionMode).toBe('quick');
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().interactionMode).toBe('inspect');
  });

  it('is a round 56 px button above the sheet on mobile, banner still at the top', async () => {
    stubMatchMedia({ [MOBILE]: true });
    const { ctx } = setup();
    renderMap(ctx, 3);
    const control = screen.getByRole('button', { name: 'Quick Check' });
    expect(control).toHaveClass('size-14', 'rounded-full');
    await userEvent.click(control);
    expect(useUiStore.getState().interactionMode).toBe('quick');
    expect(control).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('QUICK CHECK ON · Click a marker to check it · Q to stop')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('ignores Q while typing', () => {
    const { ctx } = setup();
    renderMap(ctx, 3);
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'q' });
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    input.remove();
  });

  it('ignores Q and Esc while a modal dialog is open', async () => {
    const { ctx } = setup();
    renderMap(ctx, 3);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    try {
      await userEvent.keyboard('q');
      expect(useUiStore.getState().interactionMode).toBe('inspect');
      act(() => { useUiStore.getState().setMode('quick'); });
      await userEvent.keyboard('{Escape}');
      expect(useUiStore.getState().interactionMode).toBe('quick');
    } finally {
      dialog.remove();
    }
  });

  it('puts a shorter zoom hint on its own line on mobile', () => {
    stubMatchMedia({ [MOBILE]: true });
    const { ctx } = setup();
    renderMap(ctx, 1);
    act(() => { useUiStore.getState().setMode('quick'); });
    const hint = screen.getByText('Zoom in first');
    expect(hint).toHaveClass('block');
    expect(screen.queryByText(/Zoom in to quick-check/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('adds the zoom hint on dots (zoom < 2)', () => {
    const { ctx } = setup();
    renderMap(ctx, 1);
    act(() => { useUiStore.getState().setMode('quick'); });
    expect(screen.getByText(/Q to stop · Zoom in to quick-check/)).toBeInTheDocument();
  });
});

function UndoHarness({ ctx }: { ctx: WorldCtx }) {
  useUndoShortcut(ctx);
  return <input aria-label="Name" />;
}

describe('useUndoShortcut', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUndoStack.getState().clear(); });
  afterEach(() => vi.unstubAllGlobals());

  function renderHarness(ctx: WorldCtx) {
    render(<QueryClientProvider client={ctx.queryClient}><ToastProvider><UndoHarness ctx={ctx} /></ToastProvider></QueryClientProvider>);
  }

  it('Ctrl+Z sets a single entry back to its previous value without recording it again', async () => {
    const { calls } = stubFetch({ [`PUT /api/worlds/${W}/marks/M1`]: { body: { rev: 2 } } });
    const { ctx, toasts } = setup();
    useUndoStack.getState().push({ kind: 'single', actor: 'M1', prev: false, prevMismatch: false });
    renderHarness(ctx);
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(toasts).toContainEqual({ message: 'Undone' }));
    expect(calls).toEqual([{ method: 'PUT', path: `/api/worlds/${W}/marks/M1`, body: { collected: false } }]);
    expect(useUndoStack.getState().stack).toEqual([]);
  });

  it('Cmd+Z restores a bulk entry and refetches the marks', async () => {
    const { calls } = stubFetch({
      [`POST /api/worlds/${W}/marks/restore`]: { body: { rev: 5 } },
      [`GET /api/worlds/${W}/marks`]: { body: { rev: 5, marks: [] } },
    });
    const { ctx, client } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    useUndoStack.getState().push({ kind: 'bulk', rows: [['C1', true, 1], ['M1', false, 0]] });
    renderHarness(ctx);
    await userEvent.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.marks(W) }));
    expect(calls[0]).toEqual({ method: 'POST', path: `/api/worlds/${W}/marks/restore`, body: { rows: [['C1', true, 1], ['M1', false, 0]] } });
  });

  it('restores the mismatch flag of a single entry that was a conflict', async () => {
    const { calls } = stubFetch({ [`POST /api/worlds/${W}/marks/restore`]: { body: { rev: 5 } } });
    const { ctx } = setup();
    useUndoStack.getState().push({ kind: 'single', actor: 'C1', prev: true, prevMismatch: true });
    renderHarness(ctx);
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(calls[0]).toEqual({ method: 'POST', path: `/api/worlds/${W}/marks/restore`, body: { rows: [['C1', true, 1]] } }));
  });

  it('is ignored while a modal dialog is open', async () => {
    const { calls } = stubFetch({});
    const { ctx } = setup();
    useUndoStack.getState().push({ kind: 'single', actor: 'M1', prev: false, prevMismatch: false });
    renderHarness(ctx);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    try {
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(calls).toEqual([]);
      expect(useUndoStack.getState().stack).toHaveLength(1);
    } finally {
      dialog.remove();
    }
  });

  it('is ignored while focus is in an input', async () => {
    const { calls } = stubFetch({});
    const { ctx } = setup();
    useUndoStack.getState().push({ kind: 'single', actor: 'M1', prev: false, prevMismatch: false });
    renderHarness(ctx);
    await userEvent.click(screen.getByRole('textbox', { name: 'Name' }));
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(calls).toEqual([]);
    expect(useUndoStack.getState().stack).toHaveLength(1);
  });
});
