import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent,
  type PointerEvent, type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { getWheelSpeed } from '../../app/prefs.js';
import { ExitFullscreenIcon, FitIcon, FullscreenIcon } from '../../components/icons.js';
import { layoutGraph, type DiagramEdge, type DiagramNode, type DiagramOptions, type GraphLink, type GraphNode } from './diagramLayout.js';
import {
  clampView, fitView, initialView, overflowSides, pinchView, revealRect, scaleLimits, wheelFactor, zoomAt, type Point, type Size, type View,
} from './viewport.js';

/** How an edge is drawn now: next to the selected or hovered node (`hot`), faded while another node is selected, or plain. */
export type EdgeState = 'hot' | 'dim' | 'plain';

/** An arrowhead the edges can use (`EdgeLook.marker`): a filled triangle in `className`'s fill. */
export interface FlowMarker { key: string; className: string; size?: number }

/** How one edge is drawn. `kind` becomes its `data-edge`, `marker` names one of the diagram's `markers`. */
export interface EdgeLook {
  kind: string;
  marker: string;
  className: string;
  width: number;
  dash?: string;
  linecap?: 'round';
  /** The label's colour and weight (added to its base classes). */
  labelClassName: string;
}

export interface FlowDiagramProps<L extends GraphLink> {
  /** The nodes with their rows; the order given is the first order within a row. */
  nodes: readonly GraphNode[];
  links: readonly L[];
  /** Layout options (memoise them; heights are measured here). */
  options?: Partial<DiagramOptions>;
  /** The diagram's name and its keyboard help (an `sr-only` description). */
  label: string;
  hint: string;
  /** The node whose panel is open. */
  selected: string | null;
  onSelect(id: string): void;
  /** Escape on a node closes the open panel. */
  onDismiss(): void;
  /** The panel's id (aria-controls of the selected node). */
  editorId: string;
  /** The element id of a node, so focus can come back to it. */
  nodeId(id: string): string;
  /** A node's accessible name. */
  nodeLabel(id: string): string;
  /** A node button's frame (border, background); position and size are set here. */
  nodeClassName(id: string, selected: boolean): string;
  /** Padding and border of a node around its measured content, top and bottom together. */
  nodeChrome(id: string): number;
  /** A node's content; `contentRef` goes on its outer element, whose height is measured. */
  renderNode(id: string, contentRef: (el: HTMLElement | null) => void): ReactNode;
  markers: readonly FlowMarker[];
  edgeKey(e: DiagramEdge<L>): string;
  edgeLook(e: DiagramEdge<L>, state: EdgeState): EdgeLook;
  /** The label next to an edge's arrowhead (decorative: the nodes' names say it too). */
  renderLabel(e: DiagramEdge<L>, state: EdgeState): ReactNode;
  /** Shown under the diagram (a legend). */
  footer?: ReactNode;
  /**
   * A node to bring into view first when the diagram is wider than its box (the factory's bottleneck), instead of the
   * top row's whole nodes; either way no node is cut at the left edge.
   */
  focus?: string | null;
  /** A visible "more →" chip while the diagram continues to the right (it pans on); none without a label. */
  moreLabel?: string;
  /**
   * Fill the screen below the diagram (the planner's production steps): the box takes the rest of the scrolling area
   * under its top edge, and at least 1.5 times the default height (the diagram at 100 %, at most 70 % of the screen).
   */
  fillScreen?: boolean;
}


/** One press of +/−, a keyboard + or −. */
const ZOOM_STEP = 1.25;
/** Shift + an arrow key pans this far. */
const KEY_PAN = 64;
/** A press turns into a drag after this many pixels (more for a finger), so a click on a node still opens it. */
const DRAG_THRESHOLD = { mouse: 4, other: 8 } as const;
/** A focus this soon after a press came from the pointer: the node is where the user pointed, no pan into view. */
const PRESS_FOCUS_MS = 600;
/** `will-change: transform` only while the view moves, so the text is drawn sharp again at the new scale afterwards. */
const SETTLE_MS = 200;
const DOT_SPACING = 24;

/**
 * How the view came about. `initial`: as the diagram opened (the start view is taken again while the layout settles
 * and when the box resizes); `fit`: "Fit" (fitted again on a resize); `free`: moved by the user (only kept in reach).
 */
type ViewMode = 'initial' | 'fit' | 'free';
interface ViewSnapshot { view: View; content: Size; box: Size }

/** The view lives outside React state, so a drag does not render the diagram again; only its chrome (fades, zoom keys) subscribes. */
function createViewStore() {
  let snap: ViewSnapshot = { view: { x: 0, y: 0, k: 1 }, content: { width: 0, height: 0 }, box: { width: 0, height: 0 } };
  const listeners = new Set<() => void>();
  return {
    get: () => snap,
    set(next: ViewSnapshot) {
      snap = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
  };
}
type ViewStore = ReturnType<typeof createViewStore>;

interface Gesture {
  /** The pointers down, in box coordinates. */
  pointers: Map<number, Point>;
  /** The view and the pointers when the gesture (or its current number of fingers) began. */
  start: View;
  from: Point[];
  /** Past the drag threshold (or two fingers): moving the view, and the click that ends it is swallowed. */
  moving: boolean;
}

/**
 * A graph drawn from top to bottom (or left to right) like the planner's plan (layout by `layoutGraph`): nodes are
 * buttons, under them an SVG with the edges and HTML labels by their arrowheads; the edges of the selected or hovered node stand out and, with
 * a node selected, the others fade. Each row is as high as its tallest node (measured after rendering, again once the
 * web fonts are in). Used by the planner (`PlanDiagram`) and the factory's production lines.
 *
 * Moved like a map (the math in `viewport.ts`): the content is one layer with a CSS transform (translate + scale, the
 * SVG edges and the HTML nodes together) in a clipped box on a dotted canvas that moves with it. A press and drag pans
 * (on a node only past a few pixels, so a click still opens it), two fingers pinch, the mouse wheel zooms around the
 * pointer (at the user's wheel speed, app/prefs.ts), a double click on the canvas zooms in (with Shift out); the keys
 * in the corner zoom, fit the whole diagram and show the zoom, which they reset to 100 %. The wheel only zooms once the diagram is engaged (the mouse moved over
 * it, pressed in it, or the focus is in it), so a page scrolled past a still pointer keeps scrolling; a trackpad pinch
 * (wheel with Ctrl) always zooms. A finger drag pans; where the diagram fits the box's height, a vertical drag still
 * scrolls the page (`touch-action: pan-y`). The view opens at 100 % with whole nodes of the top row or the `focus` node
 * in view (`initialView`), fades show the sides it continues, and it starts over when the nodes change.
 *
 * One tab stop; the arrow keys move between nodes (left and right in a row, up and down to the nearest node of the next
 * row; left to right, `options.direction`, the other way round), Home and End to the first and last, Escape closes the
 * open panel; a node that gets the focus is panned into view. Shift + arrows pan, + and − zoom around the focused node,
 * 0 shows 100 %.
 */
export function FlowDiagram<L extends GraphLink>(props: FlowDiagramProps<L>) {
  const {
    nodes, links, options, label, hint, selected, onSelect, onDismiss, editorId, nodeId, nodeLabel, nodeClassName, nodeChrome,
    renderNode, markers, edgeKey, edgeLook, renderLabel, footer, focus = null, moreLabel, fillScreen = false,
  } = props;
  const { t } = useTranslation();
  const known = useMemo(() => new Set(nodes.map(n => n.id)), [nodes]);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const layout = useMemo(() => layoutGraph(nodes, links, { ...options, heights }), [nodes, links, options, heights]);
  const byRow = useMemo(() => {
    const rows: DiagramNode[][] = Array.from({ length: layout.rows }, () => []);
    for (const n of layout.nodes) rows[n.row]!.push(n);
    return rows;
  }, [layout]);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const contents = useRef(new Map<string, HTMLElement>());
  const frame = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // Marker ids go into url(#…): letters, digits, - and _ only.
  const uid = useId().replace(/[^\w-]/g, '');
  const hintId = useId();
  const tabStop = [active, selected].find(i => i !== null && known.has(i)) ?? layout.nodes[0]?.item;

  // Each row as high as its tallest node: measure the content after rendering, lay out again if it differs (before
  // the browser paints). Not where nothing has a size (tests). The transform does not change the measured heights.
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [id, el] of contents.current) {
      const h = el.offsetHeight;
      if (h > 0) next.set(id, h + nodeChrome(id));
    }
    if (next.size === 0) return;
    const same = next.size === heights.size && [...next].every(([id, h]) => heights.get(id) === h);
    if (!same) setHeights(next);
  });
  // Web fonts change the text's height once they are in.
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => { if (live) setFontsReady(true); });
    return () => { live = false; };
  }, []);

  // ---- The view (pan and zoom) ----
  const [store] = useState(createViewStore);
  const mode = useRef<ViewMode>('initial');
  const direction = options?.direction ?? 'down';
  const latest = useRef({ layout, focus, direction });
  latest.current = { layout, focus, direction };
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  const boxSize = useCallback((): Size => ({ width: box.current?.clientWidth ?? 0, height: box.current?.clientHeight ?? 0 }), []);
  const contentSize = (): Size => ({ width: latest.current.layout.width, height: latest.current.layout.height });
  const limits = () => scaleLimits(contentSize(), boxSize());
  /** Show `next` (kept in reach), straight on the DOM, and tell the chrome. */
  const show = useCallback((next: View, how: ViewMode = 'free') => {
    const size = boxSize();
    const content = { width: latest.current.layout.width, height: latest.current.layout.height };
    const c = clampView(next, content, size);
    // Whole pixels keep the text sharp at 100 %.
    const view = { x: Math.round(c.x), y: Math.round(c.y), k: c.k };
    mode.current = how;
    const el = canvas.current;
    if (el) {
      el.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
      if (how === 'free') {
        el.style.willChange = 'transform';
        clearTimeout(settle.current);
        settle.current = setTimeout(() => { el.style.willChange = ''; }, SETTLE_MS);
      }
    }
    const b = box.current;
    if (b) {
      // The dots move and scale with the content (but never closer than half their spacing).
      let dot = DOT_SPACING * view.k;
      while (dot < DOT_SPACING / 2) dot *= 2;
      b.style.backgroundSize = `${dot}px ${dot}px`;
      b.style.backgroundPosition = `${view.x}px ${view.y}px`;
      // A finger drag only belongs to the diagram where it can move up and down; else vertical drags scroll the page.
      b.style.touchAction = content.height * view.k > size.height + 1 ? 'none' : 'pan-y';
    }
    const prev = store.get();
    if (prev.view.x !== view.x || prev.view.y !== view.y || prev.view.k !== view.k || prev.box.width !== size.width
      || prev.box.height !== size.height || prev.content.width !== content.width || prev.content.height !== content.height) {
      store.set({ view, content, box: size });
    }
  }, [boxSize, store]);
  /** How far the diagram starts lower so the zoom keys do not cover its top right node (the layout pads 16 px itself). */
  const keysInset = useCallback(() => {
    const keys = frame.current?.querySelector<HTMLElement>('[data-view-keys]');
    return keys && keys.offsetHeight > 0 ? Math.max(0, keys.offsetTop + keys.offsetHeight + 4 - 16) : 0;
  }, []);
  /** The view again for a new layout or box size, as its mode says. */
  const relayout = useCallback(() => {
    const { layout: l, focus: f, direction: d } = latest.current;
    const size = boxSize();
    if (mode.current === 'initial') show(initialView(l, size, f, d, keysInset()), 'initial');
    else if (mode.current === 'fit') show(fitView({ width: l.width, height: l.height }, size), 'fit');
    else show(store.get().view, 'free');
  }, [boxSize, keysInset, show, store]);

  // Other nodes (another line, another plan) or the other direction start over; the same nodes with new numbers keep the view.
  const contentKey = useMemo(() => `${direction}:${nodes.map(n => n.id).sort().join('\n')}`, [nodes, direction]);
  const shownFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (shownFor.current !== contentKey) {
      shownFor.current = contentKey;
      mode.current = 'initial';
    }
    relayout();
  }, [contentKey, layout, focus, relayout]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => relayout());
    observer.observe(el);
    return () => observer.disconnect();
  }, [relayout]);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const zoomBy = (factor: number, at?: Point) => {
    const { view, box: size } = store.get();
    show(zoomAt(view, view.k * factor, at ?? { x: size.width / 2, y: size.height / 2 }, limits()));
  };

  // Engaged: the mouse moved over the diagram or pressed in it (a page scrolled past a still pointer is not).
  const engaged = useRef(false);
  const pressedAt = useRef(-Infinity);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);

  const restart = (g: Gesture) => {
    g.start = store.get().view;
    g.from = [...g.pointers.values()];
  };
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    // The middle button pans too, without the browser's autoscroll.
    if (e.button === 1) e.preventDefault();
    engaged.current = true;
    pressedAt.current = performance.now();
    swallowClick.current = false;
    const g = gesture.current ?? { pointers: new Map<number, Point>(), start: store.get().view, from: [], moving: false };
    g.pointers.set(e.pointerId, local(e));
    restart(g);
    if (g.pointers.size > 1) g.moving = true;
    gesture.current = g;
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g?.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, local(e));
    const [a, b] = [...g.pointers.values()];
    if (b && g.from.length > 1) {
      swallowClick.current = true;
      show(pinchView(g.start, [g.from[0]!, g.from[1]!], [a!, b], limits()));
      return;
    }
    const dx = a!.x - g.from[0]!.x;
    const dy = a!.y - g.from[0]!.y;
    if (!g.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD[e.pointerType === 'mouse' ? 'mouse' : 'other']) return;
      g.moving = true;
      box.current?.setPointerCapture?.(e.pointerId);
      box.current?.setAttribute('data-panning', '');
    }
    swallowClick.current = true;
    show({ ...g.start, x: g.start.x + dx, y: g.start.y + dy });
  }
  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g?.pointers.delete(e.pointerId)) return;
    if (g.pointers.size > 0) {
      restart(g);
      return;
    }
    gesture.current = null;
    box.current?.removeAttribute('data-panning');
  }
  // The click that ends a drag is no click on a node.
  function onClickCapture(e: MouseEvent) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function onDoubleClick(e: MouseEvent) {
    if ((e.target as Element).closest('button')) return;
    zoomBy(e.shiftKey ? 0.5 : 2, local(e));
  }

  // The wheel (a native listener: React's is passive and cannot keep the page from scrolling).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !engaged.current && !el.contains(document.activeElement)) return;
      e.preventDefault();
      const { view } = store.get();
      // A sideways swipe (trackpad, Shift + wheel) pans.
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) show({ ...view, x: view.x - e.deltaX });
      else show(zoomAt(view, view.k * wheelFactor(e, getWheelSpeed(), store.get().box.height), local(e), scaleLimits(store.get().content, store.get().box)));
    };
    // Safari's trackpad pinch comes as gesture events, not as a wheel with Ctrl.
    let gestureStart = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureStart = store.get().view.k; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const { view, content, box: size } = store.get();
      show(zoomAt(view, gestureStart * g.scale, local(g), scaleLimits(content, size)));
    };
    const onEnter = (e: globalThis.PointerEvent) => { if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) engaged.current = true; };
    const onLeave = (e: globalThis.PointerEvent) => { if (e.pointerType === 'mouse') engaged.current = false; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('pointermove', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('pointermove', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    };
    // `local` reads a ref only.
  }, [show, store]);

  /** Shift + arrows pan, + and − zoom around the node, 0 shows 100 %; true when the key was one of these. */
  function viewKey(e: KeyboardEvent, n: DiagramNode): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const { view } = store.get();
    const centre = { x: view.x + (n.x + n.width / 2) * view.k, y: view.y + (n.y + n.height / 2) * view.k };
    const pan: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (e.shiftKey && pan[e.key]) {
      const [dx, dy] = pan[e.key]!;
      show({ ...view, x: view.x + dx * KEY_PAN, y: view.y + dy * KEY_PAN });
    } else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP, centre);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP, centre);
    else if (e.key === '0') show(zoomAt(view, 1, centre, limits()));
    else return false;
    e.preventDefault();
    return true;
  }
  function onKeyDown(e: KeyboardEvent, n: DiagramNode) {
    if (viewKey(e, n)) return;
    if (e.key === 'Escape') {
      if (selected === null) return;
      e.preventDefault();
      onDismiss();
      return;
    }
    let next: DiagramNode | undefined;
    const row = byRow[n.row]!;
    // Top to bottom left and right move within a row, up and down to the next row; left to right the other way round.
    const right = direction === 'right';
    const [prevInRow, nextInRow, prevRow, nextRow] = right
      ? ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
      : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (e.key === nextInRow) next = row[n.order + 1];
    else if (e.key === prevInRow) next = row[n.order - 1];
    else if (e.key === nextRow || e.key === prevRow) {
      const dir = e.key === nextRow ? 1 : -1;
      const centre = (m: DiagramNode) => (right ? m.y + m.height / 2 : m.x + m.width / 2);
      for (let r = n.row + dir; !next && r >= 0 && r < byRow.length; r += dir) {
        for (const m of byRow[r]!) if (!next || Math.abs(centre(m) - centre(n)) < Math.abs(centre(next) - centre(n))) next = m;
      }
    } else if (e.key === 'Home') next = layout.nodes[0];
    else if (e.key === 'End') next = layout.nodes[layout.nodes.length - 1];
    else return;
    e.preventDefault();
    if (!next) return;
    setActive(next.item);
    buttons.current.get(next.item)?.focus({ preventScroll: true });
    reveal(next);
  }
  function reveal(n: DiagramNode) {
    const { view } = store.get();
    const next = revealRect(view, { x: n.x, y: n.y, width: n.width, height: n.height }, boxSize());
    if (next.x !== view.x || next.y !== view.y) show(next);
  }
  /** A node focused from the keyboard (or by a panel closing) is panned into view; one just pressed is where the user pointed. */
  function onNodeFocus(n: DiagramNode) {
    setActive(n.item);
    setHover(n.item);
    if (performance.now() - pressedAt.current >= PRESS_FOCUS_MS) reveal(n);
  }

  // The edges of the selected and the hovered (or focused) node stand out; with a node selected the others fade.
  const hot = (e: DiagramEdge<L>) => [selected, hover].some(i => i !== null && (e.from === i || e.to === i));
  const fullscreen = useDiagramFullscreen(frame);
  const fsHeight = useFullscreenHeight(box, fullscreen.on);
  const fillHeight = useFillHeight(box, fillScreen && !fullscreen.on, layout.height);
  const stateOf = (e: DiagramEdge<L>): EdgeState => (hot(e) ? 'hot' : selected !== null ? 'dim' : 'plain');
  const edges = [...layout.edges].sort((a, b) => Number(hot(a)) - Number(hot(b)));

  return (
    <div className="flex flex-col">
      <p id={hintId} className="sr-only">{`${hint} ${t('planner.diagram.view.hint')}`}</p>
      <div ref={frame} className="relative">
        <div
          ref={box}
          data-diagram-box=""
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={onClickCapture}
          onDoubleClick={onDoubleClick}
          onDragStart={e => e.preventDefault()}
          // As high as the diagram at 100 %, at most 70 % of the screen; the rest is panned to. With `fillScreen` the
          // rest of the screen, at least 1.5 times that.
          style={{ height: fsHeight ?? fillHeight ?? layout.height }}
          className={`relative ${fillHeight === null && fsHeight === null ? 'max-h-[70svh] ' : ''}min-h-40 cursor-grab touch-pan-y overflow-clip bg-bg bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-size-[24px_24px] select-none data-panning:cursor-grabbing data-panning:**:cursor-grabbing`}
        >
          <div
            ref={canvas}
            role="group"
            aria-label={label}
            aria-describedby={hintId}
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: layout.width, height: layout.height }}
          >
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
              <defs>
                {markers.map(m => (
                  <marker key={m.key} id={`${uid}-${m.key}`} viewBox="0 0 8 8" refX="8" refY="4" markerWidth={m.size ?? 8} markerHeight={m.size ?? 8} markerUnits="userSpaceOnUse" orient="auto">
                    <path d="M0 0L8 4L0 8z" className={m.className} />
                  </marker>
                ))}
              </defs>
              {edges.map(e => {
                const state = stateOf(e);
                const look = edgeLook(e, state);
                return (
                  <path
                    key={edgeKey(e)}
                    d={e.path}
                    fill="none"
                    strokeWidth={look.width}
                    strokeDasharray={look.dash}
                    strokeLinecap={look.linecap}
                    markerEnd={`url(#${uid}-${look.marker})`}
                    data-edge={look.kind}
                    data-from={e.from}
                    data-to={e.to}
                    data-state={state}
                    className={`${look.className} ${state === 'dim' ? 'opacity-50' : ''} motion-safe:transition-opacity`}
                  />
                );
              })}
            </svg>
            {edges.map(e => {
              const state = stateOf(e);
              return (
                <span
                  key={edgeKey(e)}
                  aria-hidden="true"
                  data-label-to={e.to}
                  className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 bg-bg px-1 text-xs leading-5 whitespace-nowrap tabular-nums ${edgeLook(e, state).labelClassName} ${
                    state === 'hot' ? 'font-semibold' : state === 'dim' ? 'opacity-50' : ''
                  } motion-safe:transition-opacity`}
                  style={{ left: e.label.x, top: e.label.y, maxWidth: e.label.width }}
                >
                  {renderLabel(e, state)}
                </span>
              );
            })}
            {layout.nodes.map(n => {
              const isSelected = selected === n.item;
              return (
                <button
                  key={n.item}
                  ref={el => { if (el) buttons.current.set(n.item, el); else buttons.current.delete(n.item); }}
                  id={nodeId(n.item)}
                  type="button"
                  tabIndex={n.item === tabStop ? 0 : -1}
                  aria-label={nodeLabel(n.item)}
                  aria-expanded={isSelected}
                  aria-controls={isSelected ? editorId : undefined}
                  onClick={() => onSelect(n.item)}
                  onFocus={() => onNodeFocus(n)}
                  onBlur={() => setHover(h => (h === n.item ? null : h))}
                  onPointerEnter={() => setHover(n.item)}
                  onPointerLeave={() => setHover(h => (h === n.item ? null : h))}
                  onKeyDown={e => onKeyDown(e, n)}
                  style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
                  className={`absolute flex items-start overflow-hidden chamfer border text-left text-fg focus-ring motion-safe:transition-colors ${nodeClassName(n.item, isSelected)}`}
                >
                  {renderNode(n.item, el => { if (el) contents.current.set(n.item, el); else contents.current.delete(n.item); })}
                </button>
              );
            })}
          </div>
        </div>
        <ViewChrome
          store={store}
          moreLabel={moreLabel}
          onZoom={f => zoomBy(f)}
          onFit={() => show(fitView(contentSize(), boxSize()), 'fit')}
          onActual={() => zoomBy(1 / store.get().view.k)}
          onMore={() => { const { view, box: size } = store.get(); show({ ...view, x: view.x - size.width * 0.8 }); }}
          fullscreen={fullscreen.on}
          onFullscreen={fullscreen.toggle}
        />
      </div>
      {footer}
    </div>
  );
}

/** One key of the zoom plate, like the map's: 32 px, 44 px below 900 px. */
const VIEW_KEY = 'flex h-8 min-w-8 items-center justify-center gap-1.5 px-1.5 font-display text-lg leading-none font-semibold text-fg tabular-nums '
  + 'hover:bg-raised hover:text-accent active:bg-line focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent '
  + 'aria-disabled:pointer-events-none aria-disabled:text-muted aria-disabled:opacity-50 max-[899px]:h-11 max-[899px]:min-w-11 max-[899px]:text-[22px]';

/**
 * What lies over the view: a fade on each side the diagram continues, the "more →" chip, and the zoom plate in the
 * top right corner (−, the zoom in % that resets to 100 %, +, Fit). Renders on its own as the view moves.
 */
function ViewChrome({ store, moreLabel, onZoom, onFit, onActual, onMore, fullscreen, onFullscreen }: {
  store: ViewStore; moreLabel?: string; onZoom(factor: number): void; onFit(): void; onActual(): void; onMore(): void;
  fullscreen: boolean; onFullscreen(): void;
}) {
  const { t } = useTranslation();
  const { view, content, box } = useSyncExternalStore(store.subscribe, store.get);
  const sides = overflowSides(view, content, box);
  const { min, max } = scaleLimits(content, box);
  const percent = Math.round(view.k * 100);
  const atMin = view.k <= min + 1e-6;
  const atMax = view.k >= max - 1e-6;
  return (
    <>
      {sides.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-bg to-transparent" />}
      {sides.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-bg to-transparent" />}
      {sides.top && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-bg to-transparent" />}
      {sides.bottom && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-bg to-transparent" />}
      {sides.right && moreLabel && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onMore}
          className="absolute right-2 bottom-2 chamfer border border-accent bg-panel px-2 py-1 font-display text-xs font-semibold tracking-wider text-accent uppercase shadow"
        >
          {moreLabel}
        </button>
      )}
      <div
        role="group"
        data-view-keys=""
        aria-label={t('planner.diagram.view.label')}
        className="absolute top-2 right-2 flex divide-x divide-line overflow-hidden chamfer-window border border-line bg-panel shadow-[0_6px_18px_rgb(0_0_0/0.4)]"
      >
        <button type="button" aria-label={t('planner.diagram.view.zoomOut')} title={t('planner.diagram.view.zoomOut')} aria-disabled={atMin || undefined} onClick={() => { if (!atMin) onZoom(1 / ZOOM_STEP); }} className={VIEW_KEY}>−</button>
        <button type="button" aria-label={t('planner.diagram.view.reset', { percent })} title={t('planner.diagram.view.reset', { percent })} onClick={onActual} className={`${VIEW_KEY} min-w-14 text-sm! max-[899px]:text-base!`}>
          {percent} %
        </button>
        <button type="button" aria-label={t('planner.diagram.view.zoomIn')} title={t('planner.diagram.view.zoomIn')} aria-disabled={atMax || undefined} onClick={() => { if (!atMax) onZoom(ZOOM_STEP); }} className={VIEW_KEY}>+</button>
        <button type="button" title={t('planner.diagram.view.fitHint')} onClick={onFit} className={`${VIEW_KEY} text-sm! tracking-wider uppercase max-[899px]:text-base!`}>
          <FitIcon />
          <span className="max-sm:sr-only">{t('planner.diagram.view.fit')}</span>
        </button>
        <button
          type="button"
          aria-pressed={fullscreen}
          aria-label={t(fullscreen ? 'planner.diagram.view.exitFullscreen' : 'planner.diagram.view.fullscreen')}
          title={t(fullscreen ? 'planner.diagram.view.exitFullscreen' : 'planner.diagram.view.fullscreen')}
          onClick={onFullscreen}
          className={VIEW_KEY}
        >
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
      </div>
    </>
  );
}

/** The nearest scrolling ancestor (the world page's scroll box), else the document. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll') return p;
  }
  return null;
}

/**
 * The box height for `fillScreen`: the space from the box's top to the bottom of its scrolling area (as if scrolled to
 * the top, so it does not change while scrolling), less a margin, but at least 1.5 times the default height
 * (`min(content, 70 % of the screen)`); null when off or not measurable (tests).
 */
export function fillScreenHeight(o: { viewport: number; boxTop: number; content: number; margin?: number }): number {
  const base = Math.min(o.content, 0.7 * o.viewport);
  const rest = o.viewport - o.boxTop - (o.margin ?? 16);
  return Math.round(Math.max(rest, 1.5 * base));
}

function useFillHeight(box: { current: HTMLElement | null }, on: boolean, content: number): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!on || !el || typeof window === 'undefined') { setHeight(null); return; }
    const measure = (): void => {
      const parent = scrollParent(el);
      const viewport = parent ? parent.clientHeight : window.innerHeight;
      if (viewport <= 0) return;
      const top = el.getBoundingClientRect().top - (parent ? parent.getBoundingClientRect().top - parent.scrollTop : -window.scrollY);
      setHeight(fillScreenHeight({ viewport, boxTop: top, content }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [box, on, content]);
  return height;
}

/** The element shown full screen: the caller's `[data-fullscreen-root]` around the diagram (so its panel shows too), else the diagram. */
function fullscreenTarget(frame: HTMLElement): HTMLElement {
  return frame.closest<HTMLElement>('[data-fullscreen-root]') ?? frame.parentElement ?? frame;
}

/**
 * Full screen for the diagram and its panel: the browser's Fullscreen API where it exists (Escape leaves it), else a
 * fixed overlay over the page (`data-fullscreen` on the target, styled in theme.css; Escape leaves it too).
 */
function useDiagramFullscreen(frame: { current: HTMLElement | null }): { on: boolean; toggle(): void } {
  const [on, setOn] = useState(false);
  const overlay = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onChange = (): void => {
      const el = frame.current ? fullscreenTarget(frame.current) : null;
      setOn(el !== null && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [frame]);
  const leaveOverlay = useCallback((): void => {
    overlay.current?.removeAttribute('data-fullscreen');
    overlay.current = null;
    setOn(false);
  }, []);
  useEffect(() => {
    if (!on || !overlay.current) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) leaveOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, leaveOverlay]);
  useEffect(() => () => { overlay.current?.removeAttribute('data-fullscreen'); }, []);
  const toggle = useCallback((): void => {
    const el = frame.current ? fullscreenTarget(frame.current) : null;
    if (!el) return;
    if (on) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else leaveOverlay();
      return;
    }
    if (typeof el.requestFullscreen === 'function' && document.fullscreenEnabled !== false) {
      el.requestFullscreen().catch(() => { overlay.current = el; el.setAttribute('data-fullscreen', ''); setOn(true); });
    } else {
      overlay.current = el;
      el.setAttribute('data-fullscreen', '');
      setOn(true);
    }
  }, [frame, on, leaveOverlay]);
  return { on, toggle };
}

/** In full screen the diagram takes the screen below its top edge (less a margin); null otherwise. */
function useFullscreenHeight(box: { current: HTMLElement | null }, on: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!on || !box.current) { setHeight(null); return; }
    const el = box.current;
    const measure = (): void => setHeight(Math.max(240, Math.round(window.innerHeight - el.getBoundingClientRect().top - 12)));
    // Twice: the target grows to the screen a frame after the state changes.
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [box, on]);
  return height;
}
