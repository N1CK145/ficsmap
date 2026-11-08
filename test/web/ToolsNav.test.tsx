import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { create } from 'zustand';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset } from '../../src/shared/dataset.js';
import type { FeatureModule, Tool, WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import { pageTool, toggleTool } from '../../src/web/app/tools.js';
import { ToolButton, ToolsNav, WIDE_QUERY } from '../../src/web/features/worlds/ToolsNav.js';
import { stubMatchMedia } from './matchMedia.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };

/** A layer switch like the caves' one, as another feature would register it. */
const useNodes = create<{ visible: boolean; toggle(): void }>()(set => ({ visible: false, toggle: () => set(s => ({ visible: !s.visible })) }));
let nodesAvailable = true;
const nodesFeature: FeatureModule = {
  id: 'nodes',
  tools: [toggleTool({ id: 'nodes', order: 30, labelKey: 'caves.control', hintKey: 'caves.hint', useToggle: useNodes, useAvailable: () => nodesAvailable })],
};
/** A switch with an icon and a key, like a feature's map mode switch. */
const useHeightsProbe = create<{ visible: boolean; toggle(): void }>()(set => ({ visible: false, toggle: () => set(s => ({ visible: !s.visible })) }));
const heightsFeature: FeatureModule = {
  id: 'heights',
  tools: [{ ...toggleTool({ id: 'heights', order: 10, labelKey: 'heights.control', useToggle: useHeightsProbe }), icon: '✓', shortcut: 'H' }],
};
const ran: string[] = [];
const actionTool: Tool = { id: 'export', order: 40, labelKey: 'common.retry', action: true, useTool: () => ({ available: true, run: () => ran.push('export') }) };
const actionFeature: FeatureModule = { id: 'export', tools: [actionTool] };
const plannerFeature: FeatureModule = {
  id: 'planner',
  tools: [pageTool({ id: 'planner', order: 50, labelKey: 'planner.button', hintKey: 'planner.hint', page: 'planner' })],
  pages: [{ id: 'planner', titleKey: 'planner.title', Component: () => null }],
};

const ctx: WorldCtx = {
  worldId: W, world: {} as WorldDto, me: ME,
  index: indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} }),
  queryClient: new QueryClient(), navigate: () => {}, toast: { show: () => {} },
};

/** The navigation at `url` (the map at /w/:id), with the features above. */
function renderNav({ mobile = false, url = `/w/${W}`, features = [actionFeature, nodesFeature, heightsFeature, plannerFeature] } = {}) {
  const Nav = () => <ToolsNav ctx={ctx} mobile={mobile} />;
  const router = createMemoryRouter([{ path: '/w/:id/*', Component: Nav }], { initialEntries: [url] });
  render(
    <QueryClientProvider client={ctx.queryClient}>
      <FeaturesProvider features={features}><RouterProvider router={router} /></FeaturesProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('ToolsNav', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    useUiStore.getState().enterWorld(W);
    useNodes.setState({ visible: false });
    useHeightsProbe.setState({ visible: false });
    nodesAvailable = true;
    ran.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('from 1280 px: a tab strip', () => {
    beforeEach(() => { stubMatchMedia({ [WIDE_QUERY]: true }); });

    it('has a tab for the map and one per page, the one shown marked', async () => {
      const router = renderNav();
      const tabs = screen.getByRole('navigation', { name: 'Sections' });
      expect(within(tabs).getAllByRole('link').map(l => l.textContent)).toEqual(['Map', 'Planner']);
      expect(within(tabs).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
      const planner = within(tabs).getByRole('link', { name: 'Planner' });
      expect(planner).toHaveAttribute('href', `/w/${W}/planner`);
      expect(planner).toHaveAttribute('title', 'Production planner: from the items you need down to miners and pumps');
      expect(planner).not.toHaveAttribute('aria-current');
      await userEvent.click(planner);
      expect(router.state.location.pathname).toBe(`/w/${W}/planner`);
      expect(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('link', { name: 'Planner' })).toHaveAttribute('aria-current', 'page');
    });

    it('shows the map\'s switches and actions at its end on the map, switches with aria-pressed', async () => {
      renderNav();
      const layers = screen.getByRole('group', { name: 'Map layers' });
      expect(within(layers).getAllByRole('button').map(b => b.textContent)).toEqual(['✓Height map', 'Caves', 'Retry']);
      const heights = within(layers).getByRole('button', { name: 'Height map' });
      expect(heights).toHaveAttribute('aria-keyshortcuts', 'H');
      await userEvent.click(heights);
      expect(heights).toHaveAttribute('aria-pressed', 'true');
      expect(useHeightsProbe.getState().visible).toBe(true);
      const nodes = within(layers).getByRole('button', { name: 'Caves' });
      expect(nodes).toHaveAttribute('title', 'Show caves and their entrances (from the game data)');
      await userEvent.click(nodes);
      expect(useNodes.getState().visible).toBe(true);
      // An action is a plain button.
      const action = within(layers).getByRole('button', { name: 'Retry' });
      expect(action).not.toHaveAttribute('aria-pressed');
      await userEvent.click(action);
      expect(ran).toEqual(['export']);
    });

    it('leaves the map\'s switches out on a world page', () => {
      renderNav({ url: `/w/${W}/planner` });
      expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Map layers' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Caves' })).toBeNull();
    });

    it('hides a tool that is not available', () => {
      nodesAvailable = false;
      renderNav();
      expect(screen.queryByRole('button', { name: 'Caves' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Height map' })).toBeInTheDocument();
    });
  });

  describe('below 1280 px: the section menu', () => {
    it('is a menu button named after the section shown, with the sections and the map layers', async () => {
      renderNav();
      const button = screen.getByRole('button', { name: 'Section: Map' });
      expect(button).toHaveTextContent('Map');
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
      expect(screen.queryByRole('navigation')).toBeNull();
      await userEvent.click(button);
      const menu = screen.getByRole('menu', { name: 'Sections' });
      const sections = within(menu).getByRole('group', { name: 'Sections' });
      expect(within(sections).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Map', 'Planner']);
      expect(within(sections).getByRole('menuitem', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
      expect(within(sections).getByRole('menuitem', { name: 'Map' })).toHaveFocus();
      const layers = within(menu).getByRole('group', { name: 'Map layers' });
      expect(within(layers).getAllByRole('menuitemcheckbox').map(i => i.textContent)).toEqual(['✓Height mapH', 'Caves']);
      expect(within(layers).getByRole('menuitem', { name: 'Retry' })).toBeInTheDocument();
    });

    it('works with the keyboard: arrows, Enter on a switch, End', async () => {
      renderNav();
      const button = screen.getByRole('button', { name: 'Section: Map' });
      await userEvent.click(button);
      const menu = screen.getByRole('menu');
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      const heights = within(menu).getByRole('menuitemcheckbox', { name: /Height map/ });
      expect(heights).toHaveFocus();
      expect(heights).toHaveAttribute('aria-checked', 'false');
      await userEvent.keyboard('{ArrowDown}{Enter}');
      expect(useNodes.getState().visible).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(button).toHaveFocus();
      await userEvent.click(button);
      expect(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: /Caves/ })).toHaveAttribute('aria-checked', 'true');
      await userEvent.keyboard('{End}{Enter}');
      expect(ran).toEqual(['export']);
    });

    it('closes with Esc and leaves the key to nobody else', async () => {
      renderNav();
      await userEvent.click(screen.getByRole('button', { name: 'Section: Map' }));
      const seen: boolean[] = [];
      const listener = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
      window.addEventListener('keydown', listener);
      await userEvent.keyboard('{Escape}');
      window.removeEventListener('keydown', listener);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(seen).toEqual([true]);
      expect(screen.getByRole('button', { name: 'Section: Map' })).toHaveFocus();
    });

    it('follows a section with Space as any menu item, and is then named after it, without the map layers', async () => {
      const router = renderNav();
      await userEvent.click(screen.getByRole('button', { name: 'Section: Map' }));
      await userEvent.keyboard('{ArrowDown} ');
      expect(router.state.location.pathname).toBe(`/w/${W}/planner`);
      expect(screen.queryByRole('menu')).toBeNull();
      const button = screen.getByRole('button', { name: 'Section: Planner' });
      expect(button).toHaveFocus();
      await userEvent.click(button);
      const menu = screen.getByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: 'Planner' })).toHaveAttribute('aria-current', 'page');
      expect(within(menu).getByRole('menuitem', { name: 'Map' })).toHaveAttribute('href', `/w/${W}`);
      expect(within(menu).queryByRole('group', { name: 'Map layers' })).toBeNull();
    });

    it('is the same menu on mobile, also on wide phones in landscape', async () => {
      stubMatchMedia({ [WIDE_QUERY]: true });
      renderNav({ mobile: true });
      expect(screen.queryByRole('navigation')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Section: Map' }));
      expect(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')).toHaveLength(5);
    });
  });

  it('shows a page tool as a link button (ToolButton, for pages rendered alone)', () => {
    const tool = pageTool({ id: 'planner', order: 50, labelKey: 'planner.button', page: 'planner' });
    const Button = () => <ToolButton tool={tool} ctx={ctx} />;
    render(
      <FeaturesProvider features={[plannerFeature]}>
        <RouterProvider router={createMemoryRouter([{ path: '/w/:id/*', Component: Button }], { initialEntries: [`/w/${W}/planner`] })} />
      </FeaturesProvider>,
    );
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('aria-current', 'page');
  });
});
