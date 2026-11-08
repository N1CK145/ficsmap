import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<V extends string> { value: V; label: ReactNode }

export interface SegmentedControlProps<V extends string> {
  label: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange(v: V): void;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Radio group styled as segments. One tab stop; arrow keys move and select (WAI-ARIA radio pattern). */
export function SegmentedControl<V extends string>({ label, options, value, onChange }: SegmentedControlProps<V>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = STEP[e.key];
    let next: number;
    if (step !== undefined) next = (index + step + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 chamfer border border-line bg-bg p-0.5">
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={el => { buttons.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={e => onKeyDown(e, i)}
            className={`h-8 chamfer px-3 text-sm transition-colors focus-ring ${checked ? 'bg-accent font-semibold text-on-accent' : 'font-medium text-muted hover:bg-raised hover:text-fg'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
