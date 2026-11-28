import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanPrefs, resolveTheme } from '../../src/shared/prefs.js';

describe('theme preference', () => {
  it('keeps only known themes in stored preferences', () => {
    expect(cleanPrefs({ theme: 'light', wheelSpeed: 2 })).toEqual({ theme: 'light', wheelSpeed: 2 });
    expect(cleanPrefs({ theme: 'system' })).toEqual({ theme: 'system' });
    expect(cleanPrefs({ theme: 'sepia' })).toEqual({});
  });

  it('is dark by default; "system" follows the system', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('theme before the app loads (index.html)', () => {
  const html = readFileSync(resolve(process.cwd(), 'src/web/index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const run = (stored: string | null, prefersLight = false) => {
    document.documentElement.removeAttribute('data-theme');
    if (stored === null) localStorage.removeItem('ficsmap:prefs');
    else localStorage.setItem('ficsmap:prefs', stored);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-color-scheme: light)' && prefersLight }));
    new Function(script!)();
    vi.unstubAllGlobals();
    return document.documentElement.dataset.theme;
  };
  afterEach(() => localStorage.clear());

  it('sets the remembered theme on <html> before the stylesheet paints, so a light page does not flash dark', () => {
    expect(script).toBeDefined();
    expect(run(null)).toBe('dark');
    expect(run(JSON.stringify({ theme: 'light' }))).toBe('light');
    expect(run(JSON.stringify({ theme: 'system' }), true)).toBe('light');
    expect(run(JSON.stringify({ theme: 'system' }), false)).toBe('dark');
    expect(run('not json')).toBe('dark');
  });
});
