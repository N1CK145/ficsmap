import type { ComponentPropsWithRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link-accent';
/**
 * `touch` (44 px) is the minimum touch target for small mobile controls; `lg` (56 px) is the mobile
 * item sheet's Check.
 */
export type ButtonSize = 'sm' | 'md' | 'touch' | 'lg';
/** `square`: fixed width = height, no horizontal padding (icon buttons); `round`: the same as a circle. */
export type ButtonShape = 'default' | 'square' | 'round';

// Disabled buttons get no pointer events, so plain `hover:` is safe and also works on <a>. Pressed buttons sink by a
// pixel. Font weight lives in the variants (two weights in one class list would fight).
const BASE = 'inline-flex shrink-0 items-center justify-center gap-2 transition-[color,background-color,border-color,filter] '
  + 'duration-100 focus-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-50';

/**
 * Colour, border, background and weight only. `primary` is the one main action of a view (FICSIT orange);
 * `secondary` a plate in the raised grey; `ghost` only shows on hover; `danger` destroys something;
 * `link-accent` an accent text action (a toast's Undo).
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-on-accent hover:bg-accent-hi active:bg-accent-lo',
  secondary: 'border border-line bg-raised font-medium text-fg hover:border-edge hover:bg-line active:bg-panel',
  ghost: 'font-medium text-fg hover:bg-line active:bg-raised',
  danger: 'bg-conflict font-semibold text-on-accent hover:brightness-110 active:brightness-95',
  'link-accent': 'font-semibold text-accent hover:bg-line active:bg-raised',
};

/** Height and padding only. */
const SIZES: Record<ButtonSize, Record<Exclude<ButtonShape, 'round'>, string>> = {
  sm: { default: 'h-8 px-3 text-sm', square: 'size-8 text-sm' },
  md: { default: 'h-10 px-4', square: 'size-10' },
  touch: { default: 'h-11 px-4', square: 'size-11' },
  lg: { default: 'h-14 px-4 text-lg', square: 'size-14 text-xl' },
};

export interface ButtonStyle { variant?: ButtonVariant; size?: ButtonSize; shape?: ButtonShape }

/**
 * Button classes, also for links that look like buttons. `className` is for layout only (width,
 * margin, alignment): it must not repeat variant or size utilities, because in Tailwind v4 the
 * stylesheet order decides between conflicting utilities, not the order in `class`.
 */
export function buttonClass({ variant = 'secondary', size = 'md', shape = 'default' }: ButtonStyle = {}, className = ''): string {
  const box = shape === 'round' ? `${SIZES[size].square} rounded-full` : `${SIZES[size][shape]} chamfer`;
  return `${BASE} ${VARIANTS[variant]} ${box} ${className}`.trim();
}

export type ButtonProps = ComponentPropsWithRef<'button'> & Omit<ButtonStyle, 'shape'>;

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size }, className)} {...rest} />;
}
