import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLLECTIBLE_TYPES } from '../../src/shared/collectibleTypes.js';
import { luminance } from '../../src/web/features/resourceNodes/drawNode.js';
import { PURITY_TOKENS, RESOURCE_TOKENS } from '../../src/web/features/resourceNodes/resourceStyle.js';

// Vitest stubs CSS imports (also `?raw`), so the file is read directly (tests run from the repo root).
const css = readFileSync(resolve(process.cwd(), 'src/web/app/theme.css'), 'utf8');
const color = (token: string) => new RegExp(`--color-${token}:\\s*(#[0-9A-Fa-f]{6});`).exec(css)?.[1];
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme.css', () => {
  it('defines a colour token for every collectible type', () => {
    for (const t of COLLECTIBLE_TYPES) expect(css, t.id).toMatch(new RegExp(`--color-${t.colorToken}:\\s*#[0-9A-Fa-f]{6};`));
  });

  it('defines a colour token for every resource of the resource node layer', () => {
    for (const t of RESOURCE_TOKENS) expect(css, t).toMatch(new RegExp(`--color-${t}:\\s*#[0-9A-Fa-f]{6};`));
  });

  it('keeps every text colour at 4.5:1 on all three surfaces, text on the accent too, and form edges at 3:1', () => {
    const surfaces = ['bg', 'panel', 'raised'];
    for (const s of surfaces) expect(color(s), s).toBeDefined();
    for (const text of ['fg', 'muted', 'accent', 'conflict']) {
      for (const s of surfaces) expect(ratio(color(text)!, color(s)!), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const fill of ['accent', 'accent-hi', 'accent-lo', 'conflict']) {
      expect(ratio(color('on-accent')!, color(fill)!), `on-accent on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const s of ['bg', 'panel']) expect(ratio(color('edge')!, color(s)!), `edge on ${s}`).toBeGreaterThanOrEqual(3);
  });

  it('defines the cut-corner and hazard utilities the components use', () => {
    for (const u of ['chamfer', 'chamfer-window', 'hazard', 'hazard-danger']) expect(css).toContain(`@utility ${u} {`);
    // Browsers without corner-shape keep the plain radius.
    expect(css).toMatch(/@supports \(corner-shape: bevel\)/);
  });

  it('defines the purity colours, readable on the dark map and panels and distinct from each other', () => {
    const values = Object.values(PURITY_TOKENS).map(t => {
      const c = color(t);
      expect(c, t).toBeDefined();
      return c!;
    });
    expect(new Set(values).size).toBe(3);
    for (const c of values) {
      // As a ring on the dark map background and as text on panels at least 4.5:1 (the same holds for bg text on it).
      expect(ratio(c, color('bg')!), c).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c, color('panel')!), c).toBeGreaterThanOrEqual(4.5);
      expect(c).not.toBe(color('accent'));
      expect(c).not.toBe(color('conflict'));
    }
  });

  it('defines the Power Shard colour the resource node layer reads', () => {
    expect(css).toMatch(/--color-shard:\s*#[0-9A-Fa-f]{6};/);
  });
});

describe('fonts', () => {
  it('Barlow (body, 400/500/600) and Barlow Condensed (display, 500/600/700) are self-hosted, no Google Fonts request', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/web/index.html'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'src/web/main.tsx'), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    for (const w of [400, 500, 600]) expect(main).toContain(`import '@fontsource/barlow/${w}.css';`);
    for (const w of [500, 600, 700]) expect(main).toContain(`import '@fontsource/barlow-condensed/${w}.css';`);
    expect(css).toMatch(/--font-sans:\s*"Barlow",/);
    expect(css).toMatch(/--font-display:\s*"Barlow Condensed",/);
  });
});
