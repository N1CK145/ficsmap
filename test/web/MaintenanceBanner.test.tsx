import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import de from '../../src/web/app/i18n/de.json';
import en from '../../src/web/app/i18n/en.json';
import { api } from '../../src/web/app/api.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { MAINTENANCE_JOKES, MaintenanceBanner } from '../../src/web/app/MaintenanceBanner.js';
import { stubFetch } from './fetchStub.js';

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MaintenanceBanner /></QueryClientProvider>);
  return qc;
}

describe('MaintenanceBanner', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--app-banner-h');
  });

  it('shows nothing while the server is fine', async () => {
    const stub = stubFetch({ 'GET /api/version': { body: { version: '0.2.3' } } });
    renderBanner();
    await waitFor(() => expect(stub.calls).toHaveLength(1));
    expect(screen.queryByTestId('maintenance-banner')).toBeNull();
  });

  it('in maintenance: both versions, the way to the details and one of the jokes, on top of the page', async () => {
    stubFetch({ 'GET /api/version': { body: { version: '0.2.2', maintenance: true, dataVersion: '0.2.3' } } });
    renderBanner();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Maintenance mode');
    expect(banner).toHaveTextContent('The data was last used by ficsmap v0.2.3, this server runs v0.2.2.');
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/maintenance');
    const jokes = Object.values(en.maintenance.jokes);
    expect(jokes).toContain(screen.getByTestId('maintenance-joke').textContent);
    expect(document.documentElement.style.getPropertyValue('--app-banner-h')).toMatch(/px$/);
  });

  it('checks again on a 503 and goes away (loading everything again) when maintenance is over', async () => {
    let maintenance = false;
    stubFetch({
      'GET /api/version': () => ({ body: { version: '0.2.2', maintenance, dataVersion: '0.2.3' } }),
      'GET /api/me': () => (maintenance ? { status: 503, body: { error: 'maintenance', message: 'm' } } : { body: {} }),
    });
    const qc = renderBanner();
    await waitFor(() => expect(qc.getQueryData(['version'])).toBeDefined());
    maintenance = true;
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ status: 503, code: 'maintenance' });
    await screen.findByTestId('maintenance-banner');
    maintenance = false;
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(() => qc.refetchQueries({ queryKey: ['version'] }));
    await waitFor(() => expect(screen.queryByTestId('maintenance-banner')).toBeNull());
    expect(invalidate).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--app-banner-h')).toBe('');
  });

  it(`has ${MAINTENANCE_JOKES} jokes in both languages`, () => {
    for (const lang of [en, de]) {
      expect(Object.keys(lang.maintenance.jokes)).toEqual([...Array(MAINTENANCE_JOKES).keys()].map(String));
    }
  });
});
