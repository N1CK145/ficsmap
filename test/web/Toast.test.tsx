import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';

type ShowArg = Parameters<ReturnType<typeof useToast>['show']>[0];

function Trigger({ toasts }: { toasts: ShowArg[] }) {
  const { show } = useToast();
  return <>{toasts.map((t, i) => <button key={i} onClick={() => show(t)}>show {i}</button>)}</>;
}

function setup(toasts: ShowArg[]) {
  render(<ToastProvider><Trigger toasts={toasts} /></ToastProvider>);
  return (i: number) => fireEvent.click(screen.getByRole('button', { name: `show ${i}` }));
}

describe('Toast', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('announces through a polite live region', () => {
    const show = setup([{ message: 'Hello' }]);
    show(0);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Hello');
  });

  it('replaces the current toast with a new one', () => {
    const show = setup([{ message: 'First' }, { message: 'Second' }]);
    show(0);
    show(1);
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('runs the action and closes', () => {
    const run = vi.fn();
    const show = setup([{ message: 'Checked', action: { label: 'Undo', run } }]);
    show(0);
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo.className.split(/\s+/)).toContain('text-accent');
    expect(undo.className.split(/\s+/)).not.toContain('text-fg');
    fireEvent.click(undo);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Checked')).not.toBeInTheDocument();
  });

  it('disappears after durationMs', () => {
    vi.useFakeTimers();
    const show = setup([{ message: 'Brief', durationMs: 1000 }]);
    show(0);
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByText('Brief')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
  });

  it('defaults to 6 s and a replacement restarts the timer', () => {
    vi.useFakeTimers();
    const show = setup([{ message: 'First' }, { message: 'Second' }]);
    show(0);
    act(() => { vi.advanceTimersByTime(5000); });
    show(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Second')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('pauses the dismiss timer while hovered and resumes with the time left', () => {
    vi.useFakeTimers();
    const show = setup([{ message: 'Hover me', durationMs: 1000 }]);
    show(0);
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.mouseEnter(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(399); });
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Hover me')).not.toBeInTheDocument();
  });

  it('pauses the dismiss timer while its action has the focus', () => {
    vi.useFakeTimers();
    const show = setup([{ message: 'Checked', durationMs: 1000, action: { label: 'Undo', run: () => {} } }]);
    show(0);
    act(() => { screen.getByRole('button', { name: 'Undo' }).focus(); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Checked')).toBeInTheDocument();
    act(() => { screen.getByRole('button', { name: 'Undo' }).blur(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('Checked')).not.toBeInTheDocument();
  });
});
