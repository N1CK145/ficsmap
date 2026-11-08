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
 * A big figure with its label, for the one to three numbers that answer a tool's question (stacks per minute, power):
 * a plate with the label in condensed capitals, the value large, an optional line under it. Put tiles in a `dl` grid;
 * `main` marks the answer itself in the accent. `children` is the value (with a smaller unit inside, see `TileValue`).
 */
export function StatTile({ label, children, sub, main = false, className = '' }: {
  label: ReactNode; children: ReactNode; sub?: ReactNode; main?: boolean; className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 chamfer border px-3 py-2 ${main ? 'border-accent/60 bg-accent/10' : 'border-line bg-bg'} ${className}`}>
      <dt className="font-display text-xs font-semibold tracking-wider text-muted uppercase">{label}</dt>
      <dd className={`font-display leading-tight font-semibold tabular-nums ${main ? 'text-4xl text-accent' : 'text-3xl'}`}>{children}</dd>
      {sub !== undefined && <dd className="text-sm text-muted tabular-nums">{sub}</dd>}
    </div>
  );
}

/** A tile's value with its unit, the unit smaller and grey. */
export function TileValue({ value, unit }: { value: ReactNode; unit?: ReactNode }) {
  return <>{value}{unit !== undefined && <> <span className="font-sans text-base font-medium text-muted">{unit}</span></>}</>;
}

/**
 * One row of a `StatList`: label left, value right in tabular figures, as the game lists a machine's numbers
 * ("Power consumption ........ 4 MW"). The value is the row's `dd`, so screen readers read label and value together.
 * A long value (a sentence, a list of names) wraps within two thirds of the row instead of pushing the label out.
 */
export function StatRow({ label, value, unit, icon, hint, tone = 'default' }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="flex min-w-0 items-baseline gap-2 text-sm text-muted">
        {icon !== undefined && <span aria-hidden="true" className="flex shrink-0 items-center self-center">{icon}</span>}
        <span className="min-w-0">
          {label}
          {hint !== undefined && <span className="block text-xs max-[899px]:text-sm">{hint}</span>}
        </span>
      </dt>
      <dd className={`max-w-[65%] shrink-0 text-right font-display text-base font-semibold tabular-nums [overflow-wrap:anywhere] ${VALUE_TONES[tone]}`}>
        {value}
        {unit !== undefined && <span className="ml-1 font-sans text-sm font-medium text-muted">{unit}</span>}
      </dd>
    </div>
  );
}
