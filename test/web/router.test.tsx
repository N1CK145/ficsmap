import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { FeatureModule } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { appRoutes } from '../../src/web/router.js';

function Boom(): never { throw new Error('boom'); }

const feature: FeatureModule = {
  id: 'test',
  routes: [{ path: '/', Component: () => <p>home</p> }, { path: '/boom', Component: Boom }],
};

const renderAt = (url: string) =>
  render(<RouterProvider router={createMemoryRouter(appRoutes([feature]), { initialEntries: [url] })} />);

describe('app routes', () => {
  beforeAll(() => { initI18n(['en']); });

  it('redirects an unknown path to /', async () => {
    renderAt('/nope/deeper');
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('shows the error page with a reload link when a route throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt('/boom');
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reload page' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
