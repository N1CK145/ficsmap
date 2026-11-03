import { DOT_ZOOM } from '../map/markerStyle.js';

export type QuickClickAction = { kind: 'toggle'; collected: boolean } | { kind: 'openPanel' } | { kind: 'zoomIn' };

/**
 * What a marker click does in Quick Check (spec §10.3): dots zoom in, a conflict opens the panel
 * so nobody unchecks it by accident, anything else flips at once.
 */
export function quickClick(o: { zoom: number; collected: boolean; mismatch: boolean }): QuickClickAction {
  if (o.zoom < DOT_ZOOM) return { kind: 'zoomIn' };
  if (o.mismatch) return { kind: 'openPanel' };
  return { kind: 'toggle', collected: !o.collected };
}
