import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { SegmentedControl } from '../../src/web/components/SegmentedControl.js';

const options = [
  { value: 'show', label: 'Show' },
  { value: 'dim', label: 'Dim' },
  { value: 'hide', label: 'Hide' },
] as const;

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<'show' | 'dim' | 'hide'>('dim');
  return <SegmentedControl label="Collected" options={options} value={value}
    onChange={v => { setValue(v); onChange?.(v); }} />;
}

describe('SegmentedControl', () => {
  it('is a labelled radiogroup with the current value checked and the only tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Collected' })).toBeInTheDocument();
    const dim = screen.getByRole('radio', { name: 'Dim' });
    expect(dim).toHaveAttribute('aria-checked', 'true');
    expect(dim).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Show' })).toHaveAttribute('tabindex', '-1');
  });

  it('has 44 px segments below 900 px (touch)', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Show' })).toHaveClass('h-8', 'max-[899px]:h-11');
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Hide' }));
    expect(onChange).toHaveBeenCalledWith('hide');
    expect(screen.getByRole('radio', { name: 'Hide' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves the selection and focus with arrow keys, wrapping around', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dim' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Hide' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Hide' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Hide' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Show' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Show' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Hide' })).toHaveAttribute('aria-checked', 'true');
  });
});
