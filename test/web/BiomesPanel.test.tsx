import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { useUiStore } from '../../src/web/app/store.js';
import { HIT_CLASS, hitOptions } from '../../src/web/features/biomes/BiomeLayer.js';
import { BiomesPanel } from '../../src/web/features/biomes/BiomesPanel.js';
import { ScopeChip } from '../../src/web/features/biomes/ScopeChip.js';
import { labelPoint, labelPoints, maskRings, ringBounds, sortBiomeRows, useBiomeHover } from '../../src/web/features/biomes/useBiomes.js';
import type { MarksCache } from '../../src/web/features/marks/useMarks.js';

const WORLD = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';

const dataset: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [
    { id: 'grass-fields', name: { en: 'Grass Fields', de: 'Grass Fields' } },
    { id: 'swamp', name: { en: 'Swamp', de: 'Swamp' } },
    { id: 'dunes', name: { en: 'Dunes', de: 'Dunes' } },
    { id: 'paradise-island', name: { en: 'Paradise Island', de: 'Paradise Island' } },
  ],
  items: [
    ['S1', 'somersloop', 1, 1, 0, 0, 1], ['S2', 'somersloop', 2, 2, 0, 0, 2], ['H1', 'hard_drive', 3, 3, 0, 0, 3],
    ['S3', 'somersloop', 3, 3, 0, 1, 1], ['M1', 'mercer_sphere', 4, 4, 0, 1, 2],
    ['H2', 'hard_drive', 5, 5, 0, 2, 1],
  ],
  aliases: {},
};

function marks(collected: string[]): MarksCache {
  return {
    rev: 1, baseRev: 1, revs: new Map(), pending: new Map(),
    marks: new Map(collected.map(a => [a, { mismatch: false, updatedBy: 1, updatedAt: 0 }])),
  };
}

function renderAll() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const me: MeDto = { id: 1, displayName: 'Anna', avatarUrl: null, email: null, datasetVersion: 'test' };
  const index = indexDataset(dataset);
  client.setQueryData(queryKeys.me(), me);
  client.setQueryData(queryKeys.dataset('test'), index);
  client.setQueryData(queryKeys.marks(WORLD), marks(['H2', 'M1']));
  render(
    <QueryClientProvider client={client}>
      <ScopeChip ctx={{ index } as WorldCtx} />
      <BiomesPanel worldId={WORLD} />
    </QueryClientProvider>,
  );
}

const rows = () => screen.getAllByRole('button').filter(b => b.hasAttribute('aria-pressed'));

describe('sortBiomeRows', () => {
  const c = (done: number, total: number) => ({ done, total });
  it('puts the most items left first, then sorts by name', () => {
    const sorted = sortBiomeRows([
      { idx: 0, name: 'Swamp', count: c(1, 2) },
      { idx: 1, name: 'Grass Fields', count: c(12, 40) },
      { idx: 2, name: 'Dunes', count: c(0, 1) },
      { idx: 3, name: 'Abyss', count: c(0, 1) },
    ]);
    expect(sorted.map(r => r.name)).toEqual(['Grass Fields', 'Abyss', 'Dunes', 'Swamp']);
  });

  it('does not change its input', () => {
    const input = [{ idx: 0, name: 'B', count: { done: 0, total: 1 } }, { idx: 1, name: 'A', count: { done: 0, total: 5 } }];
    sortBiomeRows(input);
    expect(input[0]!.name).toBe('B');
  });
});

describe('maskRings', () => {
  it('is the image rectangle followed by the biome rings as holes', () => {
    const hole: [number, number][] = [[-10, 10], [-10, 20], [-20, 20]];
    expect(maskRings([hole])).toEqual([[[-256, 0], [-256, 256], [0, 256], [0, 0]], hole]);
  });
});

describe('hitOptions', () => {
  const colors = { accent: 'a', fg: 'f', bg: 'b' };
  it.each([[false, false], [false, true], [true, false]])('marks the hit polygon so it keeps the map cursor (scoped %s, hover %s)', (scoped, hover) => {
    expect(hitOptions(scoped, hover, colors).className).toBe(HIT_CLASS);
  });
});

describe('ring helpers', () => {
  it('labelPoint is the centroid of the largest ring', () => {
    const small: [number, number][] = [[0, 0], [0, 1], [-1, 1], [-1, 0]];
    const big: [number, number][] = [[-10, 10], [-10, 20], [-20, 20], [-20, 10]];
    expect(labelPoint([small, big])).toEqual([-15, 15]);
  });

  it('ringBounds covers all rings', () => {
    expect(ringBounds([[[-1, 2], [-3, 4]], [[0, 9]]])).toEqual([[-3, 2], [0, 9]]);
  });
});

describe('BiomesPanel', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    useUiStore.getState().enterWorld(WORLD);
    useBiomeHover.setState({ hovered: null });
  });

  it('lists biomes with items by items left, with done/total, and hides biomes without items', () => {
    renderAll();
    expect(rows().map(r => r.textContent)).toEqual(['Grass Fields0/3', 'Swamp1/2', 'Dunes1/1']);
    expect(screen.queryByText('Paradise Island')).toBeNull();
  });

  it('sets the scope on click, shows the chip, and clears it on a second click', async () => {
    renderAll();
    await userEvent.click(screen.getByRole('button', { name: /Swamp/ }));
    expect(useUiStore.getState().biomeScope).toBe(1);
    expect(screen.getByRole('button', { name: /Swamp/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Scope: Swamp')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Swamp/ }));
    expect(useUiStore.getState().biomeScope).toBeNull();
    expect(screen.queryByText(/^Scope:/)).toBeNull();
  });

  it('clears the scope with the chip button', async () => {
    renderAll();
    act(() => useUiStore.getState().setBiomeScope(0));
    const chip = screen.getByText('Scope: Grass Fields');
    await userEvent.click(within(chip.parentElement!).getByRole('button', { name: 'Clear scope' }));
    expect(useUiStore.getState().biomeScope).toBeNull();
  });

  it('counts only the enabled types', () => {
    renderAll();
    act(() => useUiStore.getState().showOnlyType('somersloop'));
    expect(rows().map(r => r.textContent)).toEqual(['Grass Fields0/2', 'Swamp0/1', 'Dunes0/0']);
  });

  it('sets the shared hover state on hover and clears it on leave', async () => {
    renderAll();
    const swamp = screen.getByRole('button', { name: /Swamp/ });
    await userEvent.hover(swamp);
    expect(useBiomeHover.getState().hovered).toBe(1);
    await userEvent.unhover(swamp);
    expect(useBiomeHover.getState().hovered).toBeNull();
  });
});

describe('labelPoints', () => {
  const square = (lat: number, lng: number, size: number): [number, number][] => [[lat, lng], [lat, lng + size], [lat - size, lng + size], [lat - size, lng]];
  it('names every larger part once, not holes and not small pieces', () => {
    const big = square(-10, 10, 30), hole = square(-15, 15, 15), other = square(-100, 100, 20), small = square(-200, 200, 5);
    const points = labelPoints([big, hole, other, small]);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual(labelPoint([big]));
    expect(points[1]).toEqual(labelPoint([other]));
  });

  it('always names the largest part, however small', () => {
    expect(labelPoints([square(-1, 1, 2)])).toHaveLength(1);
  });
});

