import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLLECTIBLE_TYPES } from '../../src/shared/collectibleTypes.js';

// Vitest stubs CSS imports (also `?raw`), so the file is read directly (tests run from the repo root).
const css = readFileSync(resolve(process.cwd(), 'src/web/app/theme.css'), 'utf8');

describe('theme.css', () => {
  it('defines a colour token for every collectible type', () => {
    for (const t of COLLECTIBLE_TYPES) expect(css, t.id).toMatch(new RegExp(`--color-${t.colorToken}:\\s*#[0-9A-Fa-f]{6};`));
  });
});

describe('fonts', () => {
  it('Barlow Condensed is self-hosted (no Google Fonts request) in weights 500/600/700', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/web/index.html'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'src/web/main.tsx'), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    for (const w of [500, 600, 700]) expect(main).toContain(`import '@fontsource/barlow-condensed/${w}.css';`);
  });
});
