import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset } from '../../src/shared/dataset.js';
import { collect, type WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import { FEATURES } from '../../src/web/features/index.js';
import { mapFeature } from '../../src/web/features/map/index.js';
import { ToolButton, ToolsNav } from '../../src/web/features/worlds/ToolsNav.js';
import { stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const ctx: WorldCtx = {
  worldId: W, world: {} as WorldDto, me: ME,
  index: indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} }),
  queryClient: new QueryClient(), navigate: () => {}, toast: { show: () => {} },
};
const tool = mapFeature.tools![0]!;

describe('collectibles layer switch', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ markersVisible: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is the first of the map\'s switches', () => {
    const switches = collect(FEATURES, 'tools').filter(t => t.page === undefined && !t.action);
    expect(switches[0]?.id).toBe('collectibles');
  });

  it('is on by default, toggles the markers and remembers it on the device', async () => {
    render(<QueryClientProvider client={ctx.queryClient}><ToolButton tool={tool} ctx={ctx} /></QueryClientProvider>);
    const button = screen.getByRole('button', { name: 'Collectibles' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(useUiStore.getState().markersVisible).toBe(false);
    expect(localStorage.getItem('ficsmap:collectibles')).toBe('0');
    await userEvent.click(button);
    expect(useUiStore.getState().markersVisible).toBe(true);
    expect(localStorage.getItem('ficsmap:collectibles')).toBe('1');
  });

  it('is in the section menu on mobile as a checkbox item', async () => {
    stubMatchMedia();
    const Nav = () => <ToolsNav ctx={ctx} mobile />;
    const router = createMemoryRouter([{ path: '/w/:id/*', Component: Nav }], { initialEntries: [`/w/${W}`] });
    render(
      <QueryClientProvider client={ctx.queryClient}>
        <FeaturesProvider features={[mapFeature]}><RouterProvider router={router} /></FeaturesProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Section: Map' }));
    const item = within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: /Collectibles/ });
    expect(item).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(item);
    expect(useUiStore.getState().markersVisible).toBe(false);
  });
});
