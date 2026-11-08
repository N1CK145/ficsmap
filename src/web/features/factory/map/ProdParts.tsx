import type { Band } from '../../../../shared/factory/analysis.js';
import type { MapKind } from './style.js';

/** Swatch per map kind in the Factory panel's legend. */
export const KIND_BG: Record<MapKind, string> = {
  production: 'bg-fac-production',
  extraction: 'bg-fac-extraction',
  power: 'bg-fac-power',
  building: 'bg-fac-building',
  logistics: 'bg-fac-minor',
  structure: 'bg-fac-floor',
};

/** The map's hatch on a swatch of the standing (cross) and throttled (diagonal) bands. */
export function bandHatch(band: Band): string | undefined {
  const stripe = 'color-mix(in srgb, var(--color-bg) 60%, transparent)';
  if (band === 'idle') return `repeating-linear-gradient(45deg, transparent 0 2px, ${stripe} 2px 3px), repeating-linear-gradient(-45deg, transparent 0 2px, ${stripe} 2px 3px)`;
  if (band === 'throttled') return `repeating-linear-gradient(-45deg, transparent 0 2px, ${stripe} 2px 4px)`;
  return undefined;
}
