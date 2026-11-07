import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceNodesFile } from '../../../shared/resourceNodes.js';

/**
 * Per resource its colour token (theme.css `--color-res-*`), in list order: solid ores, then fluids and
 * gases, then geysers. The colour is the second cue; every marker also carries the resource's short label
 * (from zoom 4) and the purity pips, and the hover box names both.
 */
const STYLES: readonly (readonly [id: string, token: string])[] = [
  ['Desc_OreIron_C', 'res-iron'],
  ['Desc_OreCopper_C', 'res-copper'],
  ['Desc_Stone_C', 'res-limestone'],
  ['Desc_Coal_C', 'res-coal'],
  ['Desc_OreGold_C', 'res-caterium'],
  ['Desc_RawQuartz_C', 'res-quartz'],
  ['Desc_Sulfur_C', 'res-sulfur'],
  ['Desc_OreBauxite_C', 'res-bauxite'],
  ['Desc_OreUranium_C', 'res-uranium'],
  ['Desc_SAM_C', 'res-sam'],
  ['Desc_LiquidOil_C', 'res-oil'],
  ['Desc_Water_C', 'res-water'],
  ['Desc_NitrogenGas_C', 'res-nitrogen'],
  ['Geyser', 'res-geyser'],
];
const TOKEN = new Map(STYLES.map(([id, token]) => [id, token]));
const ORDER = new Map(STYLES.map(([id], i) => [id, i]));

/** Every colour token the layer uses (for reading them from the stylesheet and the theme test). */
export const RESOURCE_TOKENS: readonly string[] = [...new Set(STYLES.map(s => s[1])), 'muted'];

/** The colour token of a resource; resources this version does not know yet are grey. */
export function resourceToken(id: string): string {
  return TOKEN.get(id) ?? 'muted';
}

/** Resource ids in list order; unknown ones last, by id. */
export function sortResources(ids: Iterable<string>): string[] {
  const rank = (id: string) => ORDER.get(id) ?? STYLES.length;
  return [...ids].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

export interface ResourceLabel { name: string; short: string }

/**
 * Display name and short marker label of a resource in the UI language; for a resource without a
 * translation the dataset's English name and its first two letters.
 */
export function useResourceLabels(file: ResourceNodesFile | null | undefined): (id: string) => ResourceLabel {
  const { t, i18n } = useTranslation();
  return useCallback((id: string) => {
    const fallback = file?.resources.find(r => r.id === id)?.name ?? id;
    const nameKey = `resourceNodes.resources.${id}`;
    const shortKey = `resourceNodes.short.${id}`;
    return {
      name: i18n.exists(nameKey) ? t(nameKey) : fallback,
      short: i18n.exists(shortKey) ? t(shortKey) : fallback.slice(0, 2),
    };
  }, [t, i18n, file]);
}
