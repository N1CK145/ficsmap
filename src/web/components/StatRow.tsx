import type { ReactNode } from 'react';

export type StatTone = 'default' | 'accent' | 'danger' | 'success' | 'muted';

const VALUE_TONES: Record<StatTone, string> = {
  default: 'text-fg',
  accent: 'text-accent',
  danger: 'text-conflict',
  success: 'text-free',
  muted: 'text-muted',
};

/** A list of label/value rows (a description list), separated by hairlines. Put `StatRow`s in it. */
export function StatList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <dl className={`flex flex-col divide-y divide-line ${className}`}>{children}</dl>;
}

export interface StatRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Shown after the value in the muted grey ("/min", "MW", "m"). */
  unit?: ReactNode;
  /** A picture before the label (decorative). */
  icon?: ReactNode;
  /** A smaller second line under the label. */
  hint?: ReactNode;
  tone?: StatTone;
}

/**
 * One row of a `StatList`: label left, value right in tabular figures, as the game lists a machine's numbers
 * ("Power consumption ........ 4 MW"). The value is the row's `dd`, so screen readers read label and value together.
 */
export function StatRow({ label, value, unit, icon, hint, tone = 'default' }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="flex min-w-0 items-center gap-2 text-sm text-muted">
        {icon !== undefined && <span aria-hidden="true" className="flex shrink-0 items-center self-center">{icon}</span>}
        <span className="min-w-0">
          {label}
          {hint !== undefined && <span className="block text-xs">{hint}</span>}
        </span>
      </dt>
      <dd className={`shrink-0 text-right font-display text-base font-semibold tabular-nums ${VALUE_TONES[tone]}`}>
        {value}
        {unit !== undefined && <span className="ml-1 font-sans text-sm font-medium text-muted">{unit}</span>}
      </dd>
    </div>
  );
}
