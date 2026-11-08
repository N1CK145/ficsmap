import { act, render, screen } from '@testing-library/react';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { LiveDot } from '../../src/web/features/live/LiveDot.js';
import { useLiveStatus } from '../../src/web/features/live/useWorldEvents.js';

describe('LiveDot', () => {
  beforeAll(() => { initI18n(['en']); });

  it('never tells the state by colour alone: a shape per state, and the word unless all is well', () => {
    act(() => useLiveStatus.setState({ status: 'live' }));
    const { container } = render(<LiveDot />);
    const mark = () => container.querySelector('[aria-hidden="true"]')!;
    // Live: a filled dot; below 1280 px only the dot (the word stays for screen readers).
    expect(mark()).toHaveClass('rounded-full', 'bg-free');
    expect(screen.getByText('Live')).toHaveClass('max-[1279px]:sr-only');
    act(() => useLiveStatus.setState({ status: 'connecting' }));
    // Connecting: a hollow ring, the word visible.
    expect(mark()).toHaveClass('rounded-full', 'border-muted');
    expect(mark()).not.toHaveClass('bg-free');
    expect(screen.getByText('Connecting…')).not.toHaveClass('max-[1279px]:sr-only');
    act(() => useLiveStatus.setState({ status: 'offline' }));
    // Offline: a cross, the word visible.
    expect(mark()).not.toHaveClass('rounded-full');
    expect(mark()).toHaveClass('bg-conflict');
    expect(screen.getByText('Offline')).not.toHaveClass('max-[1279px]:sr-only');
  });
});
