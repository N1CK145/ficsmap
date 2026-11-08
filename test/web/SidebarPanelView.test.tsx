import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SidebarPanel } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { loadPanelsCollapsed } from '../../src/web/app/persist.js';
import { SidebarPanelView, usePanelsCollapsed } from '../../src/web/features/worlds/SidebarPanelView.js';

const panel = (over: Partial<SidebarPanel> = {}): SidebarPanel => ({
  id: 'biomes', order: 20, titleKey: 'biomes.title', Component: () => <p>Biome rows</p>, ...over,
});

describe('foldable sidebar panels', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    localStorage.clear();
    usePanelsCollapsed.setState({ collapsed: {}, solo: null, soloState: {} });
  });

  it('starts folded when the panel says so, unfolds on its heading and remembers it', async () => {
    render(<SidebarPanelView panel={panel({ defaultCollapsed: true })} worldId="w" />);
    const head = screen.getByRole('button', { name: 'Biomes' });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Biome rows')).not.toBeVisible();
    await userEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Biome rows')).toBeVisible();
    expect(loadPanelsCollapsed()).toEqual({ biomes: false });
  });

  it('starts open by default and keeps its content mounted while folded', async () => {
    render(<SidebarPanelView panel={panel()} worldId="w" />);
    const head = screen.getByRole('button', { name: 'Biomes' });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(head);
    expect(screen.getByText('Biome rows')).not.toBeVisible();
    expect(screen.getByRole('region', { name: 'Biomes' })).toBeInTheDocument();
  });

  it('folds the other panels while one has the room and gives them back as they were', async () => {
    render(<><SidebarPanelView panel={panel()} worldId="w" /><SidebarPanelView panel={panel({ id: 'plan', titleKey: 'factoryMap.title', defaultCollapsed: true, Component: () => <p>Plan rows</p> })} worldId="w" /></>);
    const biomes = screen.getByRole('button', { name: 'Biomes' });
    const plan = screen.getByRole('button', { name: 'Factory plan' });
    expect(plan).toHaveAttribute('aria-expanded', 'false');
    act(() => usePanelsCollapsed.getState().setSolo('plan'));
    expect(biomes).toHaveAttribute('aria-expanded', 'false');
    expect(plan).toHaveAttribute('aria-expanded', 'true');
    // Nothing is remembered for that.
    expect(loadPanelsCollapsed()).toEqual({});
    // What the user opens meanwhile stays open.
    await userEvent.click(biomes);
    expect(biomes).toHaveAttribute('aria-expanded', 'true');
    act(() => usePanelsCollapsed.getState().setSolo(null));
    expect(biomes).toHaveAttribute('aria-expanded', 'true');
    expect(plan).toHaveAttribute('aria-expanded', 'false');
  });
});
