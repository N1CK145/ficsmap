import { render, screen } from '@testing-library/react';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { APP_VERSION, RELEASE_URL, REPO_URL } from '../../src/web/app/version.js';
import { Footer } from '../../src/web/components/Footer.js';

describe('Footer', () => {
  beforeAll(() => { initI18n(['en']); });

  it('links the version to its release page and the source to the repository', () => {
    render(<Footer />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `ficsmap v${APP_VERSION}` })).toHaveAttribute('href', RELEASE_URL);
    expect(screen.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', REPO_URL);
    expect(RELEASE_URL).toBe(`https://github.com/N1CK145/ficsmap/releases/tag/v${APP_VERSION}`);
  });
});
