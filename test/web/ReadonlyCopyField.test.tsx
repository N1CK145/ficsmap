import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReadonlyCopyField } from '../../src/web/components/ReadonlyCopyField.js';

function mockClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('ReadonlyCopyField', () => {
  it('renders a read-only input with the value', () => {
    render(<ReadonlyCopyField value="https://x/invite/a" label="Invite link" copyLabel="Copy link" copiedLabel="Copied" />);
    const input = screen.getByRole('textbox', { name: 'Invite link' });
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveValue('https://x/invite/a');
  });

  it('copies the value, shows the copied label and calls onCopied', async () => {
    const writeText = mockClipboard();
    const onCopied = vi.fn();
    render(<ReadonlyCopyField value="https://x/invite/a" onCopied={onCopied} label="Invite link" copyLabel="Copy link" copiedLabel="Copied" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(writeText).toHaveBeenCalledWith('https://x/invite/a');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it('shows a new value the parent passes after onCopied', async () => {
    mockClipboard();
    const { rerender } = render(<ReadonlyCopyField value="link-1" label="Invite link" copyLabel="Copy link" copiedLabel="Copied" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    rerender(<ReadonlyCopyField value="link-2" label="Invite link" copyLabel="Copy link" copiedLabel="Copied" />);
    expect(screen.getByRole('textbox')).toHaveValue('link-2');
  });

  it('does not report success when the clipboard rejects', async () => {
    const writeText = mockClipboard();
    writeText.mockRejectedValueOnce(new Error('denied'));
    const onCopied = vi.fn();
    render(<ReadonlyCopyField value="v" onCopied={onCopied} label="Invite link" copyLabel="Copy link" copiedLabel="Copied" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(onCopied).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('disables Copy while the value is not there yet', () => {
    render(<ReadonlyCopyField value={undefined} label="Invite link" copyLabel="Copy link" copiedLabel="Copied" />);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
