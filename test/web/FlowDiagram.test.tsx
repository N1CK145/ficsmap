import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { receivePrefs, usePrefsStore } from '../../src/web/app/prefs.js';
import { FlowDiagram, type FlowDiagramProps } from '../../src/web/features/planner/FlowDiagram.js';
import type { GraphLink, GraphNode } from '../../src/web/features/planner/diagramLayout.js';
import { FIT_PAD, fitScale } from '../../src/web/features/planner/viewport.js';

/** jsdom lays nothing out: the diagram's box is 400 × 300, everything else has no size. */
const BOX = { width: 400, height: 300 };

const NODES: GraphNode[] = [
  { id: 'a', row: 0 }, { id: 'b', row: 0 }, { id: 'c', row: 0 }, { id: 'd', row: 0 }, { id: 'e', row: 0 },
  { id: 'f', row: 1 }, { id: 'g', row: 2 }, { id: 'h', row: 3 },
];
const LINKS: GraphLink[] = [
  { from: 'a', to: 'f' }, { from: 'b', to: 'f' }, { from: 'c', to: 'f' }, { from: 'd', to: 'f' }, { from: 'e', to: 'f' },
  { from: 'f', to: 'g' }, { from: 'g', to: 'h' },
];

function setup(over: Partial<FlowDiagramProps<GraphLink>> = {}) {
  const onSelect = vi.fn();
  const props: FlowDiagramProps<GraphLink> = {
    nodes: NODES, links: LINKS, label: 'Test diagram', hint: 'Test hint.', selected: null, onSelect, onDismiss: vi.fn(), editorId: 'editor',
    nodeId: id => `node-${id}`, nodeLabel: id => `Node ${id}`, nodeClassName: () => '', nodeChrome: () => 0,
    renderNode: (id, ref) => <span ref={ref}>{id}</span>, markers: [{ key: 'm', className: '' }], edgeKey: e => `${e.from}>${e.to}`,
    edgeLook: () => ({ kind: 'k', marker: 'm', className: '', width: 1, labelClassName: '' }), renderLabel: () => null,
    ...over,
  };
  const utils = render(<FlowDiagram {...props} />);
  const canvas = screen.getByRole('group', { name: 'Test diagram' });
  const box = canvas.parentElement!;
  const view = () => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(canvas.style.transform);
    if (!m) throw new Error(`no transform: "${canvas.style.transform}"`);
    return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
  };
  const size = { width: parseFloat(canvas.style.width), height: parseFloat(canvas.style.height) };
  const node = (id: string) => within(canvas).getByRole('button', { name: `Node ${id}` });
  const keys = screen.getByRole('group', { name: 'View' });
  const key = (name: string | RegExp) => within(keys).getByRole('button', { name });
  return { ...utils, props, onSelect, canvas, box, view, size, node, key };
}

/** A mouse drag from one box point to another (jsdom's boxes sit at 0, 0). */
function drag(start: Element, from: { x: number; y: number }, to: { x: number; y: number }, box: Element) {
  fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(box, { pointerId: 1, pointerType: 'mouse', clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 });
  fireEvent.pointerMove(box, { pointerId: 1, pointerType: 'mouse', clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(box, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: to.x, clientY: to.y });
}

beforeEach(() => {
  initI18n(['en']);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-diagram-box') ? BOX.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-diagram-box') ? BOX.height : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  usePrefsStore.setState({ saved: {}, local: {}, status: 'idle' });
});

describe('FlowDiagram as a map', () => {
  it('opens at 100 % with the top of the diagram in view and says where it continues', () => {
    const { view, size, key } = setup();
    expect(size.width).toBeGreaterThan(BOX.width);
    expect(size.height).toBeGreaterThan(BOX.height);
    expect(view()).toMatchObject({ y: 0, k: 1 });
    expect(key(/^100 %/)).toHaveTextContent('100 %');
    // The pan and zoom keys are part of the diagram's description.
    expect(screen.getByRole('group', { name: 'Test diagram' })).toHaveAccessibleDescription(/^Test hint\. Drag to move the view/);
  });

  it('pans when dragged on the canvas', () => {
    const { view, box } = setup();
    const before = view();
    drag(box, { x: 200, y: 200 }, { x: 260, y: 150 }, box);
    expect(view()).toEqual({ x: before.x + 60, y: before.y - 50, k: 1 });
    expect(box).not.toHaveAttribute('data-panning');
  });

  it('opens a node on a click, but not at the end of a drag that started on it', async () => {
    const { node, onSelect, box, view } = setup();
    await userEvent.click(node('a'));
    expect(onSelect).toHaveBeenCalledWith('a');
    onSelect.mockClear();

    const before = view();
    drag(node('b'), { x: 100, y: 40 }, { x: 40, y: 40 }, box);
    fireEvent.click(node('b'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(view().x).toBe(before.x - 60);
    // A movement under the threshold is still a click.
    drag(node('b'), { x: 100, y: 40 }, { x: 102, y: 41 }, box);
    fireEvent.click(node('b'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('zooms with the wheel around the pointer once engaged, and lets the page scroll before', () => {
    const { view, box, node } = setup();
    const before = view();
    // Not engaged (the page scrolled the diagram under a still pointer): the page keeps the wheel.
    expect(fireEvent.wheel(box, { deltaY: -100, clientX: 100, clientY: 100 })).toBe(true);
    expect(view()).toEqual(before);
    // A trackpad pinch (Ctrl) always zooms.
    expect(fireEvent.wheel(box, { deltaY: -10, ctrlKey: true, clientX: 100, clientY: 100 })).toBe(false);
    expect(view().k).toBeCloseTo(Math.exp(0.1));
    // With the focus in the diagram the plain wheel zooms, keeping the content under the pointer.
    act(() => node('a').focus());
    const v0 = view();
    const at = { x: 150, y: 120 };
    fireEvent.wheel(box, { deltaY: -100, clientX: at.x, clientY: at.y });
    const v1 = view();
    expect(v1.k).toBeCloseTo(v0.k * Math.exp(0.2));
    expect((at.x - v1.x) / v1.k).toBeCloseTo((at.x - v0.x) / v0.k, 0);
    expect((at.y - v1.y) / v1.k).toBeCloseTo((at.y - v0.y) / v0.k, 0);
  });

  it('zooms more per wheel notch at a higher wheel speed (profile setting)', () => {
    const notch = (speed: number) => {
      act(() => { receivePrefs({ wheelSpeed: speed }); });
      const { view, box, node, unmount } = setup();
      act(() => node('a').focus());
      fireEvent.wheel(box, { deltaY: -100, clientX: 100, clientY: 100 });
      const k = view().k;
      unmount();
      return k;
    };
    const normal = notch(1);
    expect(normal).toBeCloseTo(Math.exp(0.2));
    expect(notch(2)).toBeGreaterThan(normal);
    expect(notch(0.5)).toBeLessThan(normal);
  });

  it('zooms with the keys in the corner, between a quarter (or what fits) and 2×', async () => {
    const { view, key, size } = setup();
    const zoomIn = key('Zoom in');
    for (let i = 0; i < 6; i++) await userEvent.click(zoomIn);
    expect(view().k).toBe(2);
    expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
    expect(key(/^200 %/)).toBeInTheDocument();
    await userEvent.click(key(/^200 %, back to 100 %/));
    expect(view().k).toBe(1);
    const zoomOut = key('Zoom out');
    for (let i = 0; i < 12; i++) await userEvent.click(zoomOut);
    const min = Math.min(0.25, fitScale(size, BOX));
    expect(view().k).toBeCloseTo(min);
    expect(zoomOut).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(key('Fit'));
    const k = fitScale(size, BOX);
    expect(view().k).toBeCloseTo(k);
    // Fitted: the whole diagram inside the box.
    expect(view().x).toBeGreaterThanOrEqual(FIT_PAD - 1);
    expect(view().x + size.width * k).toBeLessThanOrEqual(BOX.width - FIT_PAD + 1);
    expect(view().y + size.height * k).toBeLessThanOrEqual(BOX.height);
  });

  it('zooms in on a double click on the canvas, not on a node', () => {
    const { view, box, node } = setup();
    fireEvent.doubleClick(node('a'), { clientX: 50, clientY: 50 });
    expect(view().k).toBe(1);
    fireEvent.doubleClick(box, { clientX: 200, clientY: 150 });
    expect(view().k).toBe(2);
  });

  it('pans a node the keyboard moves to into view; Shift + arrows pan, + − 0 zoom', async () => {
    const { view, node, canvas } = setup();
    const e = node('e');
    const left = parseFloat(e.style.left);
    const width = parseFloat(e.style.width);
    // e lies beyond the right edge at first.
    expect(view().x + left + width).toBeGreaterThan(BOX.width);
    act(() => node('a').focus());
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(node('h'));
    act(() => node('d').focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(e);
    expect(view().x + left + width).toBeLessThanOrEqual(BOX.width - FIT_PAD);

    const v0 = view();
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(view()).toEqual({ ...v0, x: v0.x + 64 });
    // Shift + arrow pans; the focus stays.
    expect(document.activeElement).toBe(e);
    await userEvent.keyboard('+');
    expect(view().k).toBeCloseTo(1.25);
    await userEvent.keyboard('-');
    expect(view().k).toBeCloseTo(1);
    await userEvent.keyboard('++0');
    expect(view().k).toBe(1);
    expect(canvas).toBeInTheDocument();
  });

  it('starts over when the nodes change, and keeps the view when only the numbers do', async () => {
    const { view, box, rerender, props } = setup();
    const start = view();
    drag(box, { x: 200, y: 200 }, { x: 150, y: 120 }, box);
    const moved = view();
    expect(moved).not.toEqual(start);
    rerender(<FlowDiagram {...props} links={[...LINKS]} />);
    expect(view()).toEqual(moved);
    rerender(<FlowDiagram {...props} nodes={NODES.slice(0, 3)} links={[]} />);
    expect(view().k).toBe(1);
    expect(view()).not.toEqual(moved);
  });

  it('left to right: opens at the first column, the arrows swap roles', async () => {
    const { view, node, canvas } = setup({ options: { direction: 'right' } });
    const x = (id: string) => parseFloat(node(id).style.left);
    const y = (id: string) => parseFloat(node(id).style.top);
    expect(x('a')).toBe(x('e'));
    expect(x('a')).toBeLessThan(x('f'));
    expect(view()).toMatchObject({ x: 0, k: 1 });
    expect(canvas).toBeInTheDocument();
    const column = ['a', 'b', 'c', 'd', 'e'].sort((p, q) => y(p) - y(q));
    act(() => node(column[0]!).focus());
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(node(column[1]!));
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(node('f'));
  });
});
