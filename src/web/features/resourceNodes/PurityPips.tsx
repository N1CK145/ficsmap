import type { Purity } from '../../../shared/resourceNodes.js';
import { pipOffsets } from './drawNode.js';

/** The purity as on the map: 1, 2 or 3 pips. Decorative; the text next to it names the purity. */
export function PurityPips({ purity, className = '' }: { purity: Purity; className?: string }) {
  return (
    <svg viewBox="-9 -3 18 6" width="18" height="6" aria-hidden="true" className={`shrink-0 ${className}`}>
      {pipOffsets(purity, 6.2).map(dx => <circle key={dx} cx={dx} cy={0} r={2.4} fill="currentColor" />)}
    </svg>
  );
}

/** A resource's colour swatch (its theme token). Decorative. */
export function ResourceSwatch({ token, hollow = false }: { token: string; hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full border border-fg/40"
      style={hollow ? { borderColor: `var(--color-${token})`, borderWidth: 2 } : { background: `var(--color-${token})` }}
    />
  );
}
