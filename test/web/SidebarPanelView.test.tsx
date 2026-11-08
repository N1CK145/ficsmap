import { render, screen } from '@testing-library/react';
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
    usePanelsCollapsed.setState({ collapsed: {} });
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
});
