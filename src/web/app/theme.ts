import { useEffect } from 'react';
import { resolveTheme, type ThemePref } from '../../shared/prefs.js';
import { usePrefsStore } from './prefs.js';

/**
 * The interface theme (`UserPrefs.theme`): `data-theme="dark" | "light"` on `<html>`, which switches the colour tokens
 * of theme.css. index.html sets it from this device's remembered preferences before the stylesheet paints; from then
 * on `useApplyTheme` (in App) keeps it in step with the preference and, for `system`, with the system's setting.
 */

const LIGHT_QUERY = '(prefers-color-scheme: light)';

type PrefsState = ReturnType<typeof usePrefsStore.getState>;
const themeOf = (s: PrefsState): ThemePref | undefined => s.local.theme ?? s.saved.theme;

/** The theme preference as the profile page shows it (dark when none is stored). */
export const useThemePref = (): ThemePref => usePrefsStore(s => themeOf(s) ?? 'dark');

function systemLight(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null;
}

function meta(name: string): HTMLMetaElement {
  let m = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!m) {
    m = document.createElement('meta');
    m.name = name;
    document.head.appendChild(m);
  }
  return m;
}

/** Puts a theme on the page: the attribute, the browser's colour scheme and the browser bar's colour. */
export function applyTheme(theme: 'dark' | 'light'): void {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  meta('color-scheme').content = theme;
  const bg = getComputedStyle(root).getPropertyValue('--color-bg').trim();
  if (bg) meta('theme-color').content = bg;
}

/** Keeps `<html data-theme>` in step with the preference and, for `system`, with the system's light or dark setting. */
export function useApplyTheme(): void {
  const pref = usePrefsStore(themeOf);
  useEffect(() => {
    const query = systemLight();
    const apply = () => applyTheme(resolveTheme(pref, !(query?.matches ?? false)));
    apply();
    if (pref !== 'system' || !query) return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [pref]);
}
