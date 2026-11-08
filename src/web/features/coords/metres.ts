import { UNITS_PER_METER } from '../../../shared/geo.js';

/**
 * Whole metres in the UI language for lengths in world units (cm), as the item panel and the coordinates under the
 * mouse show positions. A value just below zero shows as "0", not "-0".
 */
export function wholeMetres(locale: string): (units: number) => string {
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'negative' });
  return units => f.format(units / UNITS_PER_METER);
}
