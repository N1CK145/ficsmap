import { act, renderHook } from '@testing-library/react';
import { loadSidebarWidth, saveSidebarWidth } from '../../src/web/app/persist.js';
import { clampSidebarWidth, SIDEBAR, useSidebarWidth } from '../../src/web/features/worlds/useSidebarWidth.js';

describe('clampSidebarWidth', () => {
  it('keeps widths between the minimum and the maximum', () => {
    expect(clampSidebarWidth(100, 2000)).toBe(SIDEBAR.min);
    expect(clampSidebarWidth(400.4, 2000)).toBe(400);
    expect(clampSidebarWidth(5000, 2000)).toBe(SIDEBAR.max);
  });

  it('never takes more than 60 % of a narrow window, but never less than the minimum', () => {
    expect(clampSidebarWidth(700, 1000)).toBe(600);
    expect(clampSidebarWidth(700, 300)).toBe(SIDEBAR.min);
  });
});

describe('sidebar width persistence', () => {
  afterEach(() => localStorage.clear());

  it('remembers a dragged width and forgets it on reset', () => {
    expect(loadSidebarWidth()).toBeNull();
    saveSidebarWidth(412.6);
    expect(loadSidebarWidth()).toBe(413);
    saveSidebarWidth(null);
    expect(loadSidebarWidth()).toBeNull();
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('ficsmap:sidebarWidth', 'wide');
    expect(loadSidebarWidth()).toBeNull();
  });
});

describe('useSidebarWidth', () => {
  afterEach(() => localStorage.clear());

  it('starts at the fixed default width, whatever the panels hold, so it does not jump while they load or fold', () => {
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.width).toBe(SIDEBAR.initial);
    expect(result.current).not.toHaveProperty('contentRef');
  });

  it('keeps a stored width, and a double-click goes back to the default and forgets it', () => {
    saveSidebarWidth(500);
    const { result } = renderHook(() => useSidebarWidth());
    expect(result.current.width).toBe(500);
    act(() => { result.current.handleProps.onDoubleClick(); });
    expect(result.current.width).toBe(SIDEBAR.initial);
    expect(loadSidebarWidth()).toBeNull();
  });
});
