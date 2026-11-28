import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COLLECTIBLE_TYPES } from '../../src/shared/collectibleTypes.js';
import { luminance } from '../../src/web/features/resourceNodes/drawNode.js';
import { mapStyle } from '../../src/web/features/map/mapStyle.js';
import { deltaE, minDeltaE, simulate } from './colorDistance.js';
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

  it('keeps the impure purity red clearly apart from the conflict red, also for protan and deutan viewers', () => {
    expect(minDeltaE(color('purity-impure')!, color('conflict')!)).toBeGreaterThanOrEqual(10);
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

describe('light theme', () => {
  /** The `--color-*` declarations of the first rule with this exact selector. */
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf('}', start));
    return new Map([...body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6});/g)].map(m => [m[1]!, m[2]!]));
  };
  const light = block(':root[data-theme="light"]');
  const mapDark = block(':root[data-theme="light"] [data-theme="dark"]');
  const l = (token: string) => light.get(token) ?? color(token)!;

  it('only changes tokens the dark theme defines, and the map block puts back exactly their dark values', () => {
    for (const t of light.keys()) expect(color(t), t).toBeDefined();
    expect([...mapDark.keys()]).toEqual([...light.keys()]);
    for (const [t, v] of mapDark) expect(v, t).toBe(color(t));
  });

  it('keeps every text colour at 4.5:1 on all three surfaces, text on the accent and the unlock badges too, form edges at 3:1', () => {
    const surfaces = ['bg', 'panel', 'raised'];
    const texts = ['fg', 'muted', 'accent', 'conflict', 'free', 'power', 'shard', 'sloop', ...Object.values(PURITY_TOKENS),
      'cat-production', 'cat-extraction', 'cat-power', 'cat-logistics', 'cat-special', 'cat-vehicles', 'unlock-mam', 'unlock-shop'];
    for (const text of texts) {
      for (const s of surfaces) expect(ratio(l(text), l(s)), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const fill of ['accent', 'accent-hi', 'accent-lo', 'conflict']) {
      expect(ratio(l('on-accent'), l(fill)), `on-accent on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
    // The unlock badges write the page colour on their fill.
    for (const fill of ['unlock-mam', 'unlock-shop']) expect(ratio(l('bg'), l(fill)), `bg on ${fill}`).toBeGreaterThanOrEqual(4.5);
    for (const s of ['bg', 'panel']) expect(ratio(l('edge'), l(s)), `edge on ${s}`).toBeGreaterThanOrEqual(3);
  });

  it('keeps the impure red apart from the conflict red here too', () => {
    expect(minDeltaE(l('purity-impure'), l('conflict'))).toBeGreaterThanOrEqual(10);
  });

  it('leaves the map dark: map drawing reads its colours through mapStyle, never from <html>', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
    const offenders = files(resolve(process.cwd(), 'src/web/features'))
      .filter(f => readFileSync(f, 'utf8').includes('getComputedStyle(document.documentElement)'));
    expect(offenders).toEqual([]);
    const probe = mapStyle();
    expect(probe).toBeDefined();
    expect(document.querySelector('[data-theme="dark"][hidden]')).not.toBeNull();
  });

  it('is light: the page is lighter than its text', () => {
    expect(luminance(l('bg'))).toBeGreaterThan(luminance(l('fg')));
    expect(css).toMatch(/:root\[data-theme="light"\] \{\s*color-scheme: light;/);
  });
});

describe('colour distance helper', () => {
  it('measures ΔE00 and simulates protan and deutan vision', () => {
    expect(deltaE('#FF5C5C', '#FF5C5C')).toBe(0);
    // Reference values from an independent implementation.
    expect(deltaE('#FF5C5C', '#F7666B')).toBeCloseTo(3.3, 1);
    expect(deltaE('#FF5C5C', '#FFA94D')).toBeCloseTo(29.4, 1);
    expect(simulate('#FFFFFF', 'protan')).toBe('#ffffff');
    expect(minDeltaE('#FF5C5C', '#FFA94D')).toBeCloseTo(11.5, 1);
  });
});
