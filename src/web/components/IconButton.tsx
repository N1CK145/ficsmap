import type { ComponentPropsWithRef } from 'react';
import { buttonClass, type ButtonShape, type ButtonSize, type ButtonVariant } from './Button.js';

/** A button that shows only an icon; the label is required because it is the accessible name. */
export type IconButtonProps = ComponentPropsWithRef<'button'> & {
  'aria-label': string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: Exclude<ButtonShape, 'default'>;
};

export function IconButton({ variant = 'ghost', size = 'md', shape = 'square', className, type = 'button', ...rest }: IconButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, shape }, className)} {...rest} />;
}
