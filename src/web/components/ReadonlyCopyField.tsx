import { useId, useState, type ReactNode } from 'react';
import { Button } from './Button.js';
import { fieldClass } from './Field.js';

export interface ReadonlyCopyFieldProps {
  /** undefined while the value is still loading; Copy is disabled then. */
  value: string | undefined;
  onCopied?: () => void;
  copiedLabel: string;
  copyLabel: string;
  hint?: ReactNode;
  /** Accessible name of the input. */
  label: string;
}

/**
 * Read-only input with a Copy button. After a successful copy the button keeps showing `copiedLabel`,
 * also when the parent swaps in a fresh value from `onCopied` (one-time invite links, spec §8).
 */
export function ReadonlyCopyField({ value, onCopied, copiedLabel, copyLabel, hint, label }: ReadonlyCopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const hintId = useId();

  async function copy() {
    if (value === undefined) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // No clipboard access: the text stays selectable in the field.
    }
    setCopied(true);
    onCopied?.();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          readOnly
          value={value ?? ''}
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          onFocus={e => e.currentTarget.select()}
          className={fieldClass({}, 'min-w-0 flex-1 font-mono text-sm')}
        />
        <Button variant="primary" disabled={value === undefined} onClick={copy}>{copied ? copiedLabel : copyLabel}</Button>
      </div>
      {hint && <div id={hintId} className="text-sm text-muted">{hint}</div>}
    </div>
  );
}
