import type { CSSProperties } from 'react';
import type { Band } from '../../../../shared/factory/analysis.js';
import { BAND_TOKEN, bandLook, PAUSED_LOOK, PAUSED_TOKEN, type BandLook, type MapKind } from './style.js';

/** Swatch per map kind in the Factory panel's legend. */
export const KIND_BG: Record<MapKind, string> = {
  production: 'bg-fac-production',
  extraction: 'bg-fac-extraction',
  power: 'bg-fac-power',
  building: 'bg-fac-building',
  logistics: 'bg-fac-minor',
  structure: 'bg-fac-floor',
};

const mix = (token: string, pct: number) => `color-mix(in srgb, var(--color-${token}) ${Math.round(pct * 100)}%, transparent)`;

/**
 * The CSS of a legend swatch drawn like the map draws that band (`BAND_LOOK`): the tint, the pattern (dots, stripes,
 * cross-hatch) and the edge in the band colour. `null`: buildings without production.
 */
export function swatchStyle(band: Band | 'paused' | null): CSSProperties {
  if (band === null) return { backgroundColor: mix('fac-minor', 0.3), border: `1px solid ${mix('fac-minor', 0.6)}` };
  const token = band === 'paused' ? PAUSED_TOKEN : BAND_TOKEN[band] ?? PAUSED_TOKEN;
  const look: BandLook = band === 'paused' ? PAUSED_LOOK : bandLook(band);
  const color = `var(--color-${token})`;
  const bg = 'var(--color-bg)';
  const pattern: Record<BandLook['pattern'], string | undefined> = {
    none: undefined,
    dots: `radial-gradient(circle at 1.5px 1.5px, ${color} 1px, transparent 1.3px) 0 0 / 4px 4px`,
    stripes: `repeating-linear-gradient(-45deg, ${color} 0 2px, transparent 2px 4px)`,
    cross: `repeating-linear-gradient(45deg, transparent 0 2px, ${bg} 2px 3px), repeating-linear-gradient(-45deg, transparent 0 2px, ${bg} 2px 3px)`,
  };
  const layers = pattern[look.pattern];
  return {
    background: layers ? `${layers}, ${mix(token, look.tint)}` : mix(token, look.tint),
    border: `1px solid ${color}`,
  };
}

/** A 12 px swatch of a band (or paused, or no production) for the legend. */
export function BandSwatch({ band }: { band: Band | 'paused' | null }) {
  return <span aria-hidden="true" className="size-3 shrink-0" style={swatchStyle(band)} />;
}
