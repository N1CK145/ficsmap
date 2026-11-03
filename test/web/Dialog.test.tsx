import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../../src/web/components/ConfirmDialog.js';
import { Dialog } from '../../src/web/components/Dialog.js';
import { initI18n } from '../../src/web/app/i18n/index.js';

const dialog = () => document.querySelector('dialog')!;

describe('Dialog', () => {
  beforeAll(() => { initI18n(['en']); });

  it('opens with its title as the accessible name and mounts content only while open', () => {
    const { rerender } = render(<Dialog open={false} onClose={() => {}} title="Rename">Body</Dialog>);
    expect(dialog()).not.toHaveAttribute('open');
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    rerender(<Dialog open onClose={() => {}} title="Rename">Body</Dialog>);
    expect(dialog()).toHaveAttribute('open');
    expect(screen.getByRole('dialog', { name: 'Rename' })).toHaveTextContent('Body');
  });

  it('turns Esc (the cancelable cancel event) into onClose and keeps the dialog for the parent to close', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Rename">Body</Dialog>);
    const notPrevented = fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(notPrevented).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a native close while still open', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Rename">Body</Dialog>);
    fireEvent(dialog(), new Event('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores the close event that follows the parent closing it', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open onClose={onClose} title="Rename">Body</Dialog>);
    rerender(<Dialog open={false} onClose={onClose} title="Rename">Body</Dialog>);
    fireEvent(dialog(), new Event('close'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Rename">Body</Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog', () => {
  beforeAll(() => { initI18n(['en']); });

  it('calls onConfirm and onCancel from its buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete world?" message="This cannot be undone." confirmLabel="Delete" danger
      onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('works with a message only, which then names the dialog', () => {
    render(<ConfirmDialog open message="Uncheck 3 items?" confirmLabel="Uncheck" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Uncheck 3 items?' })).toBeInTheDocument();
  });

  it('cancels on Esc', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open message="Sure?" confirmLabel="Yes" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
