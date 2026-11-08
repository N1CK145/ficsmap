import { readFileSync } from 'node:fs';

/**
 * The game's descriptor docs: `<install>/CommunityResources/Docs/<culture>.json` (en-US.json, de.json, ...),
 * shipped with every Satisfactory install. An array of `{NativeClass, Classes: [...]}`; every class is a
 * flat object of string values (`mDisplayName`, `mStackSize`, `mCachedStackSize`, `mInventorySize`, ...).
 * The files are UTF-16 LE with a byte order mark.
 *
 * This module only reads what the vehicle calculator needs (item stack sizes and energy values,
 * vehicle inventories and fuel burn, station timings); keep further Docs parsing (recipes, buildings) next to it, not mixed into it.
 */

export type DocsClass = Record<string, string> & { ClassName: string; NativeClass: string };

/** Reads and flattens a Docs file; UTF-16 LE (with BOM, as the game ships it) or UTF-8. */
export function readDocsFile(path: string): DocsClass[] {
  return parseDocs(readFileSync(path));
}

export function parseDocs(bytes: Uint8Array): DocsClass[] {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  let text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const groups = JSON.parse(text) as { NativeClass: string; Classes: Record<string, string>[] }[];
  if (!Array.isArray(groups)) throw new Error('Docs file is not an array of native classes');
  return groups.flatMap(g => g.Classes.map(c => ({ ...c, NativeClass: g.NativeClass }) as DocsClass));
}

export function byClassName(docs: readonly DocsClass[]): Map<string, DocsClass> {
  return new Map(docs.map(c => [c.ClassName, c]));
}

const FORMS = new Set(['RF_SOLID', 'RF_LIQUID', 'RF_GAS']);

export interface DocsItem {
  className: string;
  name: string;
  /** `mCachedStackSize`: the numeric stack size the game resolved from `mStackSize` (SS_MEDIUM = 100, SS_FLUID = 50000, ...). */
  stackSize: number;
  fluid: boolean;
  /** `mEnergyValue`: MJ per item (per litre for fluids); 0 for items that are no fuel. */
  energyMJ: number;
}

/**
 * Every item with a physical form (solid, liquid, gas): resources, parts, equipment, consumables.
 * Buildings and vehicles have the form `RF_INVALID` and are left out.
 */
export function docsItems(docs: readonly DocsClass[]): DocsItem[] {
  const items: DocsItem[] = [];
  for (const c of docs) {
    if (!FORMS.has(c.mForm ?? '')) continue;
    const stackSize = Number(c.mCachedStackSize);
    if (!Number.isInteger(stackSize) || stackSize <= 0) throw new Error(`${c.ClassName}: no numeric mCachedStackSize (${c.mCachedStackSize})`);
    const energyMJ = Number(c.mEnergyValue ?? 0);
    if (!Number.isFinite(energyMJ) || energyMJ < 0) throw new Error(`${c.ClassName}: mEnergyValue is not a number (${c.mEnergyValue})`);
    items.push({ className: c.ClassName, name: c.mDisplayName ?? c.ClassName, stackSize, fluid: c.mForm !== 'RF_SOLID', energyMJ });
  }
  return items;
}

/** A required numeric field of a Docs class. */
export function docsNumber(docs: Map<string, DocsClass>, className: string, field: string): number {
  const c = docs.get(className);
  if (!c) throw new Error(`Docs: class ${className} not found`);
  const n = Number(c[field]);
  if (c[field] === undefined || !Number.isFinite(n)) throw new Error(`Docs: ${className}.${field} is not a number (${c[field]})`);
  return n;
}
