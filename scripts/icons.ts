import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_CLASS, ITEM_ICONS_DIR, itemIconPath, type ItemIconIndex } from '../src/shared/icons.js';

/**
 * The dataset part `icons` (see src/shared/icons.ts): copies the descriptor pictures the extractor exported with
 * `--icons-out` (`<dir>/index.json`, `<dir>/<size>/<class>.webp`) into `<dataset>/icons/items/` and writes the
 * dataset's `index.json`. Kept: every descriptor that is not a building (items, resources, equipment, ammunition,
 * vehicles) and the buildings given in `buildings` (the machine wiki's entries); the other building descriptors
 * (walls, foundations, signs, ...) are left out. See data-src/extractor/README.md, "Pictures".
 */

export class IconBuildError extends Error {
  constructor(public problems: string[]) {
    super(`Icon build failed:\n- ${problems.join('\n- ')}`);
    this.name = 'IconBuildError';
  }
}

const BUILDING = 'FGBuildingDescriptor';

export interface IconSelection {
  sizes: number[];
  /** Classes to copy, sorted. */
  icons: string[];
  /** Building descriptors left out. */
  skipped: number;
  /** Requested buildings the extractor has no picture for. */
  missing: string[];
}

/**
 * Which pictures of the extractor's `index.json` go into the dataset. Fails on a malformed index or class names
 * that could not be file names.
 */
export function selectIcons(raw: unknown, buildings: ReadonlySet<string>): IconSelection {
  const problems: string[] = [];
  const d = (raw ?? {}) as { format?: unknown; sizes?: unknown; icons?: unknown };
  if (d.format !== 'webp') problems.push(`format is ${JSON.stringify(d.format)}, expected "webp"`);
  const sizes = Array.isArray(d.sizes) ? d.sizes : [];
  if (sizes.length === 0 || !sizes.every(s => Number.isInteger(s) && s > 0 && s <= 1024)) problems.push(`bad sizes ${JSON.stringify(d.sizes)}`);
  const entries = d.icons !== null && typeof d.icons === 'object' ? Object.entries(d.icons as Record<string, unknown>) : [];
  if (entries.length === 0) problems.push('the index lists no icons');
  const icons: string[] = [];
  let skipped = 0;
  for (const [cls, info] of entries) {
    if (!ICON_CLASS.test(cls)) { problems.push(`bad class name ${JSON.stringify(cls)}`); continue; }
    const native = (info as { nativeClass?: unknown } | null)?.nativeClass;
    if (typeof native !== 'string') { problems.push(`${cls} has no nativeClass`); continue; }
    if (native === BUILDING && !buildings.has(cls)) skipped++;
    else icons.push(cls);
  }
  if (problems.length > 0) throw new IconBuildError(problems);
  const listed = new Set(icons);
  return {
    sizes: [...(sizes as number[])].sort((a, b) => a - b),
    icons: icons.sort(),
    skipped,
    missing: [...buildings].filter(b => !listed.has(b)).sort(),
  };
}

export interface IconResult { index: ItemIconIndex; bytes: number; skipped: number; missing: string[] }

/**
 * Copies the selected pictures from the extractor's icon folder into `<outDir>/icons/items/` (replacing what was there)
 * and writes its `index.json`. Fails if a listed picture file is missing.
 */
export function writeIcons(srcDir: string, outDir: string, buildings: ReadonlySet<string>): IconResult {
  const selection = selectIcons(JSON.parse(readFileSync(join(srcDir, 'index.json'), 'utf8')), buildings);
  const missingFiles = selection.icons.flatMap(cls => selection.sizes
    .map(size => join(srcDir, String(size), `${cls}.webp`))
    .filter(f => !existsSync(f)));
  if (missingFiles.length > 0) throw new IconBuildError(missingFiles.map(f => `${f} is listed in index.json but missing`));

  const dir = join(outDir, ITEM_ICONS_DIR);
  rmSync(dir, { recursive: true, force: true });
  let bytes = 0;
  for (const size of selection.sizes) {
    mkdirSync(join(dir, String(size)), { recursive: true });
    for (const cls of selection.icons) {
      const target = join(outDir, itemIconPath(cls, size));
      copyFileSync(join(srcDir, String(size), `${cls}.webp`), target);
      bytes += statSync(target).size;
    }
  }
  const index: ItemIconIndex = { format: 1, sizes: selection.sizes, icons: selection.icons };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  return { index, bytes, skipped: selection.skipped, missing: selection.missing };
}

/** One line for the build log. */
export function iconSummary(r: IconResult): string {
  return `${r.index.icons.length} pictures at ${r.index.sizes.join(' and ')} px (${(r.bytes / 1e6).toFixed(1)} MB), `
    + `${r.skipped} other building descriptors left out`
    + (r.missing.length > 0 ? `; no picture for ${r.missing.join(', ')}` : '');
}
