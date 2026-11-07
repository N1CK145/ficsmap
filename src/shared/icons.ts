/**
 * Pictures of items, buildings and vehicles in a dataset (dataset part `icons`, folder `icons/items/`): the game's own
 * descriptor icons, exported from the paks by the extractor patch (`--icons-out`) as square WebP files with a
 * transparent background, one per descriptor class and size: `icons/items/<size>/<class>.webp`. `index.json` next to
 * them lists the sizes and the classes that have a picture, so clients request only files that exist.
 */
export interface ItemIconIndex {
  format: 1;
  /** Edge lengths in px, ascending (64 and 256). */
  sizes: number[];
  /** Descriptor classes with a picture (`Desc_IronPlate_C`, `Desc_ConstructorMk1_C`, `Desc_Truck_C`), sorted. */
  icons: string[];
}

export const ITEM_ICONS_DIR = 'icons/items';

/** A descriptor class name as the game writes it; nothing else becomes a file or URL path. */
export const ICON_CLASS = /^[A-Za-z0-9_]{1,128}$/;

/** Path of one picture inside the dataset folder. */
export function itemIconPath(cls: string, size: number): string {
  return `${ITEM_ICONS_DIR}/${size}/${cls}.webp`;
}

/** An `index.json` read from the network or disk, or null when it is not a valid one. Bad class names are dropped. */
export function parseItemIconIndex(raw: unknown): ItemIconIndex | null {
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.format !== 1 || !Array.isArray(d.sizes) || !Array.isArray(d.icons)) return null;
  const sizes = d.sizes.filter((s): s is number => Number.isInteger(s) && (s as number) > 0 && (s as number) <= 1024).sort((a, b) => a - b);
  if (sizes.length === 0) return null;
  return { format: 1, sizes, icons: d.icons.filter((c): c is string => typeof c === 'string' && ICON_CLASS.test(c)) };
}

/** The picture size to load for `px` CSS pixels: the smallest that covers it, else the largest. */
export function iconSizeFor(sizes: readonly number[], px: number): number {
  return sizes.find(s => s >= px) ?? sizes[sizes.length - 1]!;
}
