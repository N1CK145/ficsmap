import type { ReactNode } from 'react';
import type { Reason } from '../../../shared/factory/analysis.js';

/** 16 px line icons of the factory page, drawn like `components/icons.tsx` (currentColor, decorative). */
function Icon({ children, size = 16, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {children}
    </svg>
  );
}

/** The factory section: a factory hall with a chimney and a gauge needle. */
export const FactoryIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="M1.5 14V7l4 2.5V7l4 2.5V2.5h3V14zM1.5 14h13" /><path d="M5 12h1.5M9 12h1.5" /></Icon>
);

/**
 * One glyph per reason, so a reason never depends on its colour alone (the text says it too). The SVG paths (16 × 16,
 * stroked) are shared with the factory map's canvas, which draws the same glyphs with `Path2D`.
 */
export const REASON_PATHS: Record<Reason, string> = {
  // an empty input: an arrow into an open box
  starved: 'M2 8h6M5.5 5.5L8 8l-2.5 2.5M10 3.5h3.5v9H10',
  // the output is full: a filled box with a stop bar
  blocked: 'M2.5 3.5h7v9h-7zM2.5 8h7M12.5 3v10',
  // more than is taken off: a full box with an arrow rising out of it
  surplus: 'M2.5 8.5h11v5h-11zM8 6.5V1.5M5.5 4L8 1.5 10.5 4',
  noPower: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z',
  noFuel: 'M8 2s4 4.5 4 7.5a4 4 0 01-8 0C4 6.5 8 2 8 2zM3 13L13 3',
  paused: 'M5.5 3.5v9M10.5 3.5v9',
  noRecipe: 'M3.5 2.5h9v11h-9zM6 6.5a2 2 0 113 1.7c-.6.4-1 .8-1 1.5M8 11.5v.01',
  // ran only part of the time: a wave
  unknown: 'M1.5 9c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4 0',
};

export function ReasonIcon({ reason, size = 14 }: { reason: Reason; size?: number }) {
  return <Icon size={size}><path d={REASON_PATHS[reason]} /></Icon>;
}

/** Shown on the map: a crosshair over a pin. */
export const LocateIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}><circle cx="8" cy="8" r="4.5" /><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" /><circle cx="8" cy="8" r="1" /></Icon>
);

/** A full belt or pipe: a warning triangle. */
export const FullIcon = ({ size = 12 }: { size?: number }) => (
  <Icon size={size}><path d="M8 2L14.5 13.5h-13zM8 6.5v3.5M8 12v.01" /></Icon>
);

/** The line's bottleneck: an exclamation mark in an octagon (a stop sign), apart from a merely full belt's triangle. */
export const NeckIcon = ({ size = 12 }: { size?: number }) => (
  <Icon size={size}><path d="M5.5 1.5h5l4 4v5l-4 4h-5l-4-4v-5zM8 4.5v4.5M8 11.5v.01" /></Icon>
);

/** A full belt that carries exactly what is made: an equals sign (no warning). */
export const ExactIcon = ({ size = 12 }: { size?: number }) => (
  <Icon size={size}><path d="M3 6h10M3 10h10" /></Icon>
);
