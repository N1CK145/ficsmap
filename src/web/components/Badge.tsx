import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'power';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-raised text-muted',
  accent: 'border-accent/50 bg-accent/12 text-accent',
  success: 'border-free/50 bg-free/12 text-free',
  danger: 'border-conflict/50 bg-conflict/12 text-conflict',
  power: 'border-power/50 bg-power/12 text-power',
};

/** Badge classes, for a link or button that should look like one (a removable chip). */
export function badgeClass(tone: BadgeTone = 'neutral', className = ''): string {
  return `inline-flex h-5 shrink-0 items-center gap-1 chamfer border px-1.5 font-display text-xs font-semibold tracking-wider whitespace-nowrap uppercase tabular-nums ${TONES[tone]} ${className}`.trim();
}

/**
 * A small label plate: a role, a state, a count, a tier. Colour is never the only cue: the text says it. Tones:
 * neutral (grey), accent (active, selected), success, danger (conflicts, errors), power (shards, power).
 */
export function Badge({ tone = 'neutral', children, className = '', title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={badgeClass(tone, className)}>{children}</span>;
}
