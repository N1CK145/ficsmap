import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type L from 'leaflet';
import { useState } from 'react';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import { ToastProvider, useToast } from '../../src/web/components/Toast.js';
import { flyToOrSet } from '../../src/web/features/map/motion.js';
import { BottomSheet } from '../../src/web/features/mobile/BottomSheet.js';
import type { Snap } from '../../src/web/features/mobile/snap.js';
import { useSidebarKey } from '../../src/web/features/worlds/useSidebarKey.js';
import { REDUCED_MOTION, stubMatchMedia } from './matchMedia.js';

describe('accessibility', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('announces toasts through an aria-live region', () => {
    function Show() {
      const toast = useToast();
      return <button onClick={() => toast.show({ message: 'Mercer Sphere checked' })}>show</button>;
    }
    render(<ToastProvider><Show /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Mercer Sphere checked');
  });

  describe('[ toggles the sidebar', () => {
    beforeEach(() => { useUiStore.getState().setSidebarOpen(true); });

    it('closes and opens the sidebar', async () => {
      renderHook(() => useSidebarKey(true));
      await userEvent.keyboard('[[');
      expect(useUiStore.getState().sidebarOpen).toBe(false);
      await userEvent.keyboard('[[');
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });

    it('leaves typed text, Ctrl+[ and the mobile layout alone', async () => {
      const { rerender } = renderHook(({ on }) => useSidebarKey(on), { initialProps: { on: true } });
      render(<input aria-label="Name" />);
      await userEvent.click(screen.getByRole('textbox', { name: 'Name' }));
      await userEvent.keyboard('[[');
      expect(useUiStore.getState().sidebarOpen).toBe(true);
      screen.getByRole('textbox', { name: 'Name' }).blur();
      await userEvent.keyboard('{Control>}[[{/Control}');
      expect(useUiStore.getState().sidebarOpen).toBe(true);
      rerender({ on: false });
      await userEvent.keyboard('[[');
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });
  });

  describe('flyToOrSet', () => {
    const fakeMap = () => ({ flyTo: vi.fn(), setView: vi.fn() });

    it('jumps with setView when reduced motion is preferred', () => {
      stubMatchMedia({ [REDUCED_MOTION]: true });
      const map = fakeMap();
      flyToOrSet(map as unknown as L.Map, [10, 20], 4);
      expect(map.setView).toHaveBeenCalledWith([10, 20], 4, { animate: false });
      expect(map.flyTo).not.toHaveBeenCalled();
    });

    it('flies otherwise', () => {
      stubMatchMedia({ [REDUCED_MOTION]: false });
      const map = fakeMap();
      flyToOrSet(map as unknown as L.Map, [10, 20], 4);
      expect(map.flyTo).toHaveBeenCalledWith([10, 20], 4);
      expect(map.setView).not.toHaveBeenCalled();
    });
  });

  it('the bottom sheet handle is a button that cycles peek → half → full → peek', async () => {
    function Sheet() {
      const [snap, setSnap] = useState<Snap>('peek');
      return <BottomSheet label="Panels" snap={snap} onSnap={setSnap}><p>{snap} content</p></BottomSheet>;
    }
    render(<Sheet />);
    const handle = screen.getByRole('button', { name: /Panel size/ });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(handle).toHaveAccessibleName('Panel size: small');
    handle.focus();
    await userEvent.keyboard('{Enter}');
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(handle).toHaveAccessibleName('Panel size: half');
    expect(screen.getByText('half content')).toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(handle).toHaveAccessibleName('Panel size: full');
    await userEvent.click(handle);
    expect(handle).toHaveAccessibleName('Panel size: small');
    expect(screen.getByRole('region', { name: 'Panels' })).toContainElement(handle);
  });

  it('dragging the handle snaps with nearestSnap on release', () => {
    vi.stubGlobal('innerHeight', 844);
    const onSnap = vi.fn();
    render(<BottomSheet label="Panels" snap="peek" onSnap={onSnap}><p>content</p></BottomSheet>);
    const handle = screen.getByRole('button', { name: /Panel size/ });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const at = (ms: number) => { now = ms; };
    // Slowly up by 330 px, from peek (112) to 442: next to half (422).
    act(() => {
      at(0);
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 800 });
      at(1000);
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 600 });
      at(2000);
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 470 });
      at(3000);
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 470 });
    });
    // The click that ends a drag does not also cycle the size.
    fireEvent.click(handle, { detail: 1 });
    expect(onSnap).toHaveBeenCalledTimes(1);
    expect(onSnap).toHaveBeenCalledWith('half');
  });

  it('a lost pointer capture ends the drag like a cancel, without snapping', () => {
    vi.stubGlobal('innerHeight', 844);
    const onSnap = vi.fn();
    render(<BottomSheet label="Panels" snap="peek" onSnap={onSnap}><p>content</p></BottomSheet>);
    const handle = screen.getByRole('button', { name: /Panel size/ });
    const sheet = screen.getByRole('region', { name: 'Panels' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 600 });
    expect(sheet.style.height).toBe('312px');
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    expect(sheet.style.height).toBe('112px');
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300 });
    expect(onSnap).not.toHaveBeenCalled();
  });
});
