import { useContext } from 'react';
import type { Purity } from '../../../shared/resourceNodes.js';
import { GameIcon, IconsContext } from '../machineWiki/icons.js';
import { pipOffsets } from './drawNode.js';
import { PURITY_TEXT } from './resourceStyle.js';

/** The purity as on the map: 1, 2 or 3 pips, in the purity's colour. Decorative; the text next to it names the purity. */
export function PurityPips({ purity, className = '' }: { purity: Purity; className?: string }) {
  return (
    <svg viewBox="-9 -3 18 6" width="18" height="6" aria-hidden="true" className={`shrink-0 ${PURITY_TEXT[purity]} ${className}`}>
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

/**
 * A resource's game picture (`IconsContext`, dataset part `icons`), or its colour swatch where the dataset has no
 * picture of it (geysers) or no pictures at all. Decorative: the resource's name stands next to it.
 */
export function ResourceIcon({ id, token, hollow = false, px = 16 }: { id: string; token: string; hollow?: boolean; px?: number }) {
  const icons = useContext(IconsContext);
  return icons?.has(id)
    ? <GameIcon cls={id} px={px} placeholder />
    : <span className="inline-flex shrink-0 items-center justify-center" style={{ width: px, height: px }}><ResourceSwatch token={token} hollow={hollow} /></span>;
}
