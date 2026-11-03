import { useState } from 'react';
import type { CollectibleType } from '../../../shared/collectibleTypes.js';
import { useMe } from '../worlds/queries.js';
import { DISK_R, PIP_R, PIP_X, RING_R, SHAPE, SWIRL } from './drawMarker.js';
import { useTypeIconUrl } from './typeImages.js';

const points = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

function Shape({ type, fill }: { type: CollectibleType; fill: string }) {
  const common = { fill, stroke: 'var(--color-bg)', strokeWidth: 2, strokeLinejoin: 'round' as const };
  switch (type.shape) {
    case 'circle':
      return <circle r={SHAPE.circleR} {...common} />;
    case 'square': {
      const h = SHAPE.squareHalf;
      return <rect x={-h} y={-h} width={h * 2} height={h * 2} rx={SHAPE.squareRadius} {...common} />;
    }
    case 'diamond': {
      const h = SHAPE.diamondHalf;
      return <polygon points={`0,${-h} ${h},0 0,${h} ${-h},0`} {...common} />;
    }
    case 'triangle': {
      const { top, half, bottom } = SHAPE.triangle;
      return <polygon points={`0,${top} ${half},${bottom} ${-half},${bottom}`} {...common} />;
    }
  }
}

function Glyph({ type }: { type: CollectibleType }) {
  if (type.pips > 0) {
    return PIP_X[type.pips as 1 | 2 | 3].map(x => (
      <circle key={x} cx={x} r={PIP_R} fill="var(--color-fg)" stroke="var(--color-bg)" strokeWidth={1} />
    ));
  }
  const dark = { fill: 'none', stroke: 'var(--color-bg)', strokeLinecap: 'round' as const };
  switch (type.glyph) {
    case 'swirl':
      return <polyline points={points(SWIRL)} strokeWidth={1.6} {...dark} />;
    case 'ring':
      return <circle r={RING_R} strokeWidth={1.8} {...dark} />;
    case 'disk':
      return <circle cy={SHAPE.triangleCentroidY} r={DISK_R} fill="var(--color-bg)" />;
    case 'none':
      return null;
  }
}

/** The type's shape marker as a small inline SVG (same geometry as the canvas markers). */
function ShapeIcon({ type, size, className }: { type: CollectibleType; size: number; className?: string }) {
  return (
    <svg viewBox="-10 -10 20 20" width={size} height={size} aria-hidden="true" focusable="false" className={className}>
      <Shape type={type} fill={`var(--color-${type.colorToken})`} />
      <Glyph type={type} />
    </svg>
  );
}

/** The type's game icon for lists; the shape marker while that is not known or the dataset lacks the icon. */
export function TypeIcon({ type, size = 16, className }: { type: CollectibleType; size?: number; className?: string }) {
  const url = useTypeIconUrl(useMe().data?.datasetVersion, type);
  const [failed, setFailed] = useState<string | null>(null);
  if (url === null || failed === url) return <ShapeIcon type={type} size={size} className={className} />;
  return (
    <img src={url} width={size} height={size} alt="" aria-hidden="true" draggable={false} decoding="async"
      className={`inline-block shrink-0 object-contain ${className ?? ''}`} onError={() => setFailed(url)} />
  );
}
