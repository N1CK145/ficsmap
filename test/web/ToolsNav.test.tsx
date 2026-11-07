import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { create } from 'zustand';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset } from '../../src/shared/dataset.js';
import type { FeatureModule, Tool, WorldCtx } from '../../src/web/app/feature.js';
import { FeaturesProvider } from '../../src/web/app/FeaturesContext.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import { toggleTool } from '../../src/web/app/tools.js';
import { quickCheckFeature } from '../../src/web/features/quickCheck/index.js';
import { ToolsNav, WIDE_QUERY } from '../../src/web/features/worlds/ToolsNav.js';
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
const ran: string[] = [];
const actionTool: Tool = { id: 'export', order: 40, labelKey: 'common.retry', useTool: () => ({ available: true, run: () => ran.push('export') }) };
const actionFeature: FeatureModule = { id: 'export', tools: [actionTool] };

function renderNav({ mobile = false } = {}) {
  const ctx: WorldCtx = {
    worldId: W, world: {} as WorldDto, me: ME, index: indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} }),
    queryClient: new QueryClient(), navigate: () => {}, toast: { show: () => {} },
  };
  return render(
    <QueryClientProvider client={ctx.queryClient}>
      <FeaturesProvider features={[actionFeature, nodesFeature, quickCheckFeature]}><ToolsNav ctx={ctx} mobile={mobile} /></FeaturesProvider>
    </QueryClientProvider>,
  );
}

describe('ToolsNav', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    useUiStore.getState().enterWorld(W);
    useNodes.setState({ visible: false });
    nodesAvailable = true;
    ran.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a button per tool on wide screens, in order, switches with aria-pressed', async () => {
    stubMatchMedia({ [WIDE_QUERY]: true });
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Tools' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['✓Quick Check', 'Caves', 'Retry']);
    const quick = within(nav).getByRole('button', { name: 'Quick Check' });
    expect(quick).toHaveAttribute('aria-keyshortcuts', 'Q');
    await userEvent.click(quick);
    expect(quick).toHaveAttribute('aria-pressed', 'true');
    expect(useUiStore.getState().interactionMode).toBe('quick');
    const nodes = within(nav).getByRole('button', { name: 'Caves' });
    expect(nodes).toHaveAttribute('title', 'Show caves and their entrances (from the game data)');
    await userEvent.click(nodes);
    expect(useNodes.getState().visible).toBe(true);
    expect(nodes).toHaveAttribute('aria-pressed', 'true');
    // An action is a plain button.
    expect(within(nav).getByRole('button', { name: 'Retry' })).not.toHaveAttribute('aria-pressed');
  });

  it('lists tools that open something of their own (action) in a Tools menu next to the switches on wide screens', async () => {
    stubMatchMedia({ [WIDE_QUERY]: true });
    const dialogTool: Tool = { id: 'planner', order: 50, labelKey: 'common.close', action: true, useTool: () => ({ available: true, run: () => ran.push('planner') }) };
    const ctx: WorldCtx = {
      worldId: W, world: {} as WorldDto, me: ME, index: indexDataset({ version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true, biomes: [], items: [], aliases: {} }),
      queryClient: new QueryClient(), navigate: () => {}, toast: { show: () => {} },
    };
    render(
      <QueryClientProvider client={ctx.queryClient}>
        <FeaturesProvider features={[nodesFeature, { id: 'planner', tools: [dialogTool] }]}><ToolsNav ctx={ctx} mobile={false} /></FeaturesProvider>
      </QueryClientProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Tools' });
    expect(within(nav).queryByRole('button', { name: 'Close' })).toBeNull();
    const menuButton = within(nav).getByRole('button', { name: 'Tools' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Caves', 'Tools']);
    await userEvent.click(menuButton);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
    expect(ran).toEqual(['planner']);
  });

  it('hides a tool that is not available', () => {
    stubMatchMedia({ [WIDE_QUERY]: true });
    nodesAvailable = false;
    renderNav();
    expect(screen.queryByRole('button', { name: 'Caves' })).toBeNull();
  });

  it('puts the tools in a menu on narrower screens: checkbox items for switches, keyboard included', async () => {
    renderNav();
    const button = screen.getByRole('button', { name: 'Tools' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Tools' });
    const quick = within(menu).getByRole('menuitemcheckbox', { name: /Quick Check/ });
    expect(quick).toHaveFocus();
    expect(quick).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByRole('menuitem', { name: 'Retry' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Caves/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(useNodes.getState().visible).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: /Caves/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{End}{Enter}');
    expect(ran).toEqual(['export']);
  });

  it('closes the menu with Esc and leaves the key to nobody else', async () => {
    renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Tools' }));
    const seen: boolean[] = [];
    const listener = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    window.addEventListener('keydown', listener);
    await userEvent.keyboard('{Escape}');
    window.removeEventListener('keydown', listener);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(seen).toEqual([true]);
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveFocus();
  });

  it('is an icon button with the same menu on mobile', async () => {
    stubMatchMedia({ [WIDE_QUERY]: true });
    renderNav({ mobile: true });
    expect(screen.queryByRole('navigation')).toBeNull();
    const button = screen.getByRole('button', { name: 'Tools' });
    expect(button).toHaveTextContent('');
    await userEvent.click(button);
    expect(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')).toHaveLength(3);
  });
});
