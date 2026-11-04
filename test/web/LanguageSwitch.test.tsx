import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { loadLocale } from '../../src/web/app/persist.js';
import { LanguageSwitch } from '../../src/web/components/LanguageSwitch.js';

function Probe() {
  return <p>{useTranslation().t('common.cancel')}</p>;
}

describe('LanguageSwitch', () => {
  beforeEach(() => { localStorage.clear(); });

  it('switches the UI language, sets <html lang> and remembers the choice', async () => {
    const i18n = initI18n(['en']);
    render(<I18nextProvider i18n={i18n}><LanguageSwitch /><Probe /></I18nextProvider>);
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Cancel')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Deutsch' }));
    expect(screen.getByText('Abbrechen')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sprache' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.lang).toBe('de');
    expect(loadLocale()).toBe('de');
  });

  it('starts in the remembered language rather than the browser language', () => {
    localStorage.setItem('ficsmap:locale', 'de');
    const i18n = initI18n();
    expect(i18n.language).toBe('de');
  });
});
