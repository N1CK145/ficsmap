import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import en from '../../src/web/app/i18n/en.json';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { LoginPage } from '../../src/web/features/worlds/LoginPage.js';

function renderAt(url: string) {
  const router = createMemoryRouter([{ path: '/login', Component: LoginPage }], { initialEntries: [url] });
  render(<RouterProvider router={router} />);
}

describe('LoginPage', () => {
  beforeAll(() => { initI18n(['en']); });

  it('links the Discord button to /auth/login with returnTo', () => {
    renderAt(`/login?returnTo=${encodeURIComponent('/w/abc?x=1')}`);
    expect(screen.getByRole('link', { name: 'Sign in with Discord' }))
      .toHaveAttribute('href', `/auth/login?returnTo=${encodeURIComponent('/w/abc?x=1')}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to / for a returnTo that is not a local path', () => {
    renderAt(`/login?returnTo=${encodeURIComponent('//evil.example')}`);
    expect(screen.getByRole('link', { name: 'Sign in with Discord' }))
      .toHaveAttribute('href', `/auth/login?returnTo=${encodeURIComponent('/')}`);
  });

  it.each(['invite_only', 'cancelled', 'expired', 'invite_invalid', 'failed'] as const)('shows the %s message', code => {
    renderAt(`/login?error=${code}`);
    expect(screen.getByRole('alert')).toHaveTextContent(en.login.error[code]);
  });

  it('uses the spec copy for invite_only', () => {
    renderAt('/login?error=invite_only');
    expect(screen.getByRole('alert')).toHaveTextContent('ficsmap is invite-only. Ask a friend for an invite link.');
  });

  it('shows the generic message for an unknown error code', () => {
    renderAt('/login?error=whatever');
    expect(screen.getByRole('alert')).toHaveTextContent(en.login.error.failed);
  });
});
