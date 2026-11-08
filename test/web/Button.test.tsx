import { render, screen } from '@testing-library/react';
import { Button, buttonClass } from '../../src/web/components/Button.js';
import { IconButton } from '../../src/web/components/IconButton.js';

const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe('Button', () => {
  it('gives the accent link variant accent text and no competing text colour', () => {
    render(<Button variant="link-accent">Undo</Button>);
    const c = classes(screen.getByRole('button', { name: 'Undo' }));
    expect(c).toContain('text-accent');
    expect(c).not.toContain('text-fg');
  });

  it('uses plain hover so the classes also work on links', () => {
    expect(buttonClass({ variant: 'primary' })).toMatch(/(^|\s)hover:/);
    expect(buttonClass({ variant: 'primary' })).not.toContain('enabled:hover:');
  });
});

describe('IconButton', () => {
  it('is square without horizontal padding', () => {
    render(<IconButton aria-label="Close">×</IconButton>);
    const c = classes(screen.getByRole('button', { name: 'Close' }));
    expect(c).toContain('size-10');
    expect(c).not.toContain('px-3');
    expect(c).not.toContain('px-4');
  });

  it('uses the small square for size sm', () => {
    render(<IconButton aria-label="Close" size="sm">×</IconButton>);
    const c = classes(screen.getByRole('button', { name: 'Close' }));
    expect(c).toContain('size-8');
    expect(c).not.toContain('px-3');
  });
});

describe('touch targets', () => {
  it('grows a small button to 44 px below 900 px, square ones too', () => {
    expect(buttonClass({ size: 'sm' }).split(/\s+/)).toEqual(expect.arrayContaining(['h-8', 'max-[899px]:h-11']));
    expect(buttonClass({ size: 'sm', shape: 'square' }).split(/\s+/)).toEqual(expect.arrayContaining(['size-8', 'max-[899px]:size-11']));
    // The other sizes are touch-sized already or bigger.
    expect(buttonClass({ size: 'md' })).not.toContain('max-[899px]:');
  });
});
