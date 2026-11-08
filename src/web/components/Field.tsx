import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

export type FieldSize = 'sm' | 'md';

const FIELD_SIZES: Record<FieldSize, string> = { sm: 'h-8 px-2 text-sm', md: 'h-10 px-3' };

/** The box of a form control: dark inset, a 3:1 edge (`edge`), cut corners, the accent ring on focus. */
const BOX = 'chamfer border border-edge bg-bg text-fg transition-colors hover:border-muted';

/**
 * Classes for a text input or a select (`<input className={fieldClass()} />`). `className` is for layout only (width,
 * flex), like `buttonClass`'s. Checkboxes and radios need nothing: the base styles give them the accent.
 */
export function fieldClass({ size = 'md' }: { size?: FieldSize } = {}, className = ''): string {
  return `${BOX} ${FIELD_SIZES[size]} placeholder:text-muted focus-ring ${className}`.trim();
}

/** The visible label above a field. */
export const FIELD_LABEL = 'text-sm font-medium text-muted';

export type NumberFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> & {
  /** The visible label (also the accessible name), or with `hideLabel` only the accessible name. */
  label: ReactNode;
  hideLabel?: boolean;
  /** The unit after the number inside the box ("/min", "m", "%"); screen readers hear it as the field's description. */
  unit?: ReactNode;
  /** A line under the field (a range, an explanation). */
  hint?: ReactNode;
  size?: FieldSize;
  /** Layout of the whole field (label, box, hint). */
  className?: string;
};

/**
 * A labelled number input with its unit inside the box, as in the game's machine windows ("[ 120 ] /min"). A native
 * `type="number"` input, controlled or not as the caller likes (`value`, `onChange`, `min`, `max`, `step` pass through).
 */
export function NumberField({ label, hideLabel = false, unit, hint, size = 'md', className = '', id, ...input }: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const unitId = `${inputId}-unit`;
  const hintId = `${inputId}-hint`;
  const describedBy = [input['aria-describedby'], unit !== undefined ? unitId : undefined, hint !== undefined ? hintId : undefined]
    .filter(Boolean).join(' ') || undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : FIELD_LABEL}>{label}</label>
      <div className={`flex items-center ${BOX} focus-within:border-accent focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-bg ${size === 'sm' ? 'h-8 text-sm' : 'h-10'}`}>
        <input
          inputMode="decimal"
          {...input}
          id={inputId}
          type="number"
          aria-describedby={describedBy}
          className={`h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none ${size === 'sm' ? 'px-2' : 'px-3'} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
        />
        {unit !== undefined && <span id={unitId} className={`shrink-0 text-sm text-muted ${size === 'sm' ? 'pr-2' : 'pr-3'}`}>{unit}</span>}
      </div>
      {hint !== undefined && <p id={hintId} className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
