import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';
import { ProgressPanel } from '../../src/web/features/progress/ProgressPanel.js';

const WORLD = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';

const dataset: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'grass-fields', name: { en: 'Grass Fields', de: 'Grasfelder' } }, { id: 'swamp', name: { en: 'Swamp', de: 'Sumpf' } }],
  items: [
    ['S1', 'somersloop', 1, 1, 0, 0, 1], ['S2', 'somersloop', 2, 2, 0, 0, 2], ['S3', 'somersloop', 3, 3, 0, 1, 1],
    ['M1', 'mercer_sphere', 4, 4, 0, 1, 2],
  ],
  aliases: {},
};

function marks(collected: string[]): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map(collected.map(a => [a, { mismatch: false, updatedBy: 1, updatedAt: 0 }])),
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const me: MeDto = { id: 1, displayName: 'Anna', avatarUrl: null, email: null, datasetVersion: 'test' };
  client.setQueryData(queryKeys.me(), me);
  client.setQueryData(queryKeys.dataset('test'), indexDataset(dataset));
  client.setQueryData(queryKeys.marks(WORLD), marks(['S1', 'S3']));
  render(<QueryClientProvider client={client}><ProgressPanel worldId={WORLD} /></QueryClientProvider>);
}

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('ProgressPanel', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { useUiStore.getState().enterWorld(WORLD); });

  it('shows done/total per type', () => {
    renderPanel();
    expect(row(/Somersloops/)).toHaveTextContent('2/3');
    expect(row(/Mercer Spheres/)).toHaveTextContent('0/1');
    expect(row(/Hard Drives/)).toHaveTextContent('0/0');
  });

  it('toggles the type filter on click and reflects it in aria-pressed', async () => {
    renderPanel();
    expect(row(/Somersloops/)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(row(/Somersloops/));
    expect(useUiStore.getState().typeFilter.has('somersloop')).toBe(false);
    expect(row(/Somersloops/)).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(row(/Somersloops/));
    expect(useUiStore.getState().typeFilter.has('somersloop')).toBe(true);
  });

  it('shows only that type on Alt-click', () => {
    renderPanel();
    fireEvent.click(row(/Mercer Spheres/), { altKey: true });
    expect([...useUiStore.getState().typeFilter]).toEqual(['mercer_sphere']);
  });

  it.each(['{Enter}', ' '])('shows only that type on Alt+%s and toggles without Alt', async key => {
    renderPanel();
    row(/Mercer Spheres/).focus();
    await userEvent.keyboard(`{Alt>}${key}{/Alt}`);
    expect([...useUiStore.getState().typeFilter]).toEqual(['mercer_sphere']);
    await userEvent.keyboard(key);
    expect(useUiStore.getState().typeFilter.has('mercer_sphere')).toBe(false);
  });

  it('shows only that type on a 500 ms long press, without toggling afterwards', () => {
    vi.useFakeTimers();
    try {
      renderPanel();
      const r = row(/Somersloops/);
      fireEvent.pointerDown(r);
      act(() => { vi.advanceTimersByTime(500); });
      fireEvent.pointerUp(r);
      fireEvent.click(r);
      expect([...useUiStore.getState().typeFilter]).toEqual(['somersloop']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts within the biome scope and names the biome', () => {
    useUiStore.getState().setBiomeScope(1);
    renderPanel();
    expect(row(/Somersloops/)).toHaveTextContent('1/1 in Swamp');
    expect(row(/Mercer Spheres/)).toHaveTextContent('0/1 in Swamp');
  });

  it('switches collected visibility, Dim by default', async () => {
    renderPanel();
    expect(screen.getByRole('radio', { name: 'Dim' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Hide' }));
    expect(useUiStore.getState().visibility).toBe('hide');
  });
});
