import type { ComponentPropsWithRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link-accent';
/**
 * `touch` (44 px) is the minimum touch target for small mobile controls; `lg` (56 px) is the mobile
 * item sheet's Check.
 */
export type ButtonSize = 'sm' | 'md' | 'touch' | 'lg';
/** `square`: fixed width = height, no horizontal padding (icon buttons); `round`: the same as a circle. */
export type ButtonShape = 'default' | 'square' | 'round';

// Disabled buttons get no pointer events, so plain `hover:` is safe and also works on <a>.
const BASE = 'inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-colors focus-ring '
  + 'disabled:pointer-events-none disabled:opacity-50';

/** Colour, border and background only. */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-bg hover:brightness-110',
  secondary: 'border border-line bg-panel text-fg hover:bg-line',
  ghost: 'text-fg hover:bg-line',
  danger: 'bg-conflict text-bg hover:brightness-110',
  'link-accent': 'text-accent hover:bg-line',
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
  const box = shape === 'round' ? `${SIZES[size].square} rounded-full` : `${SIZES[size][shape]} rounded`;
  return `${BASE} ${VARIANTS[variant]} ${box} ${className}`.trim();
}

export type ButtonProps = ComponentPropsWithRef<'button'> & Omit<ButtonStyle, 'shape'>;

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size }, className)} {...rest} />;
}
