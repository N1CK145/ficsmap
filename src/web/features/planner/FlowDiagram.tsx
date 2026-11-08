import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { initialScroll, layoutGraph, type DiagramEdge, type DiagramNode, type DiagramOptions, type GraphLink, type GraphNode } from './diagramLayout.js';

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
  /** Scaled down to the width of its box ("Fit to width"). */
  fit: boolean;
  /** Whether the diagram is wider than its box (then "Fit to width" is offered). */
  onOverflow(wider: boolean): void;
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
  /** "Fit to width" never scales below this (so text stays readable); the rest scrolls. */
  minZoom?: number;
  /** A visible "more →" chip while the diagram continues to the right (it scrolls on); none without a label. */
  moreLabel?: string;
}

/**
 * A graph drawn from top to bottom like the planner's plan (layout by `layoutGraph`): nodes are buttons, under them an
 * SVG with the edges and HTML labels by their arrowheads; the edges of the selected or hovered node stand out and, with
 * a node selected, the others fade. Each row is as high as its tallest node (measured after rendering, again once the
 * web fonts are in). One tab stop; the arrow keys move between nodes (left and right in a row, up and down to the
 * nearest node of the next row), Home and End to the first and last, Escape closes the open panel. Centred in its box
 * on a dotted canvas; a wider diagram starts with whole nodes of its top row in view (`initialScroll`), with a fade on
 * each side it continues, or is scaled to the box (`fit`). Used by the planner (`PlanDiagram`) and the factory's
 * production lines.
 */
export function FlowDiagram<L extends GraphLink>(props: FlowDiagramProps<L>) {
  const {
    nodes, links, options, label, hint, selected, onSelect, onDismiss, editorId, nodeId, fit, onOverflow, nodeLabel, nodeClassName, nodeChrome,
    renderNode, markers, edgeKey, edgeLook, renderLabel, footer, focus = null, minZoom = 0, moreLabel,
  } = props;
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
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [fade, setFade] = useState({ left: false, right: false });
  // Marker ids go into url(#…): letters, digits, - and _ only.
  const uid = useId().replace(/[^\w-]/g, '');
  const hintId = useId();
  const tabStop = [active, selected].find(i => i !== null && known.has(i)) ?? layout.nodes[0]?.item;
  const zoom = fit && boxWidth > 0 && layout.width > boxWidth ? Math.min(1, Math.max(minZoom, boxWidth / layout.width)) : 1;

  // Each row as high as its tallest node: measure the content after rendering, lay out again if it differs (before
  // the browser paints). Not while scaled down, and not where nothing has a size (tests).
  useLayoutEffect(() => {
    if (zoom !== 1) return;
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

  // The box's width (for "Fit to width") and the fades on the sides the diagram continues.
  const updateFade = useCallback(() => {
    const el = box.current;
    if (!el) return;
    setBoxWidth(el.clientWidth);
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade(f => (f.left === left && f.right === right ? f : { left, right }));
  }, []);
  useLayoutEffect(updateFade, [updateFade, layout, zoom]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFade]);
  const wider = boxWidth > 0 && layout.width > boxWidth;
  useEffect(() => onOverflow(wider), [wider, onOverflow]);
  // Wider than its box (also when scaled down only to `minZoom`): start with the `focus` node in the middle, else whole
  // nodes of the top row in view (`initialScroll`), never with a node cut at the left; once per top row and zoom.
  const topRow = `${byRow[0]?.map(n => n.item).join('\n') ?? ''}@${zoom}`;
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || layout.width * zoom <= el.clientWidth + 1 || scrolledFor.current === topRow) return;
    scrolledFor.current = topRow;
    const view = el.clientWidth / zoom;
    const target = focus ? layout.nodes.find(n => n.item === focus) : undefined;
    let left = target ? target.x + target.width / 2 - view / 2 : initialScroll(layout, view);
    left = Math.max(0, Math.min(left, layout.width - view));
    const cut = layout.nodes.find(n => n.x < left && n.x + n.width > left);
    if (cut && (!target || cut.x >= target.x + target.width - view)) left = Math.max(0, cut.x - 16);
    el.scrollLeft = left * zoom;
  }, [layout, zoom, topRow, focus]);

  function onKeyDown(e: KeyboardEvent, n: DiagramNode) {
    if (e.key === 'Escape') {
      if (selected === null) return;
      e.preventDefault();
      onDismiss();
      return;
    }
    let next: DiagramNode | undefined;
    const row = byRow[n.row]!;
    if (e.key === 'ArrowRight') next = row[n.order + 1];
    else if (e.key === 'ArrowLeft') next = row[n.order - 1];
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const centre = (m: DiagramNode) => m.x + m.width / 2;
      for (let r = n.row + dir; !next && r >= 0 && r < byRow.length; r += dir) {
        for (const m of byRow[r]!) if (!next || Math.abs(centre(m) - centre(n)) < Math.abs(centre(next) - centre(n))) next = m;
      }
    } else if (e.key === 'Home') next = layout.nodes[0];
    else if (e.key === 'End') next = layout.nodes[layout.nodes.length - 1];
    else return;
    e.preventDefault();
    if (!next) return;
    setActive(next.item);
    buttons.current.get(next.item)?.focus();
  }

  // The edges of the selected and the hovered (or focused) node stand out; with a node selected the others fade.
  const hot = (e: DiagramEdge<L>) => [selected, hover].some(i => i !== null && (e.from === i || e.to === i));
  const stateOf = (e: DiagramEdge<L>): EdgeState => (hot(e) ? 'hot' : selected !== null ? 'dim' : 'plain');
  const edges = [...layout.edges].sort((a, b) => Number(hot(a)) - Number(hot(b)));

  return (
    <div className="flex flex-col">
      <p id={hintId} className="sr-only">{hint}</p>
      <div className="relative">
        <div ref={box} onScroll={updateFade} className="overflow-x-auto overscroll-x-contain bg-bg bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-size-[24px_24px]">
          <div
            role="group"
            aria-label={label}
            aria-describedby={hintId}
            className="relative mx-auto"
            style={{ width: layout.width, height: layout.height, ...(zoom !== 1 ? { zoom } : {}) }}
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
                  onFocus={() => { setActive(n.item); setHover(n.item); }}
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
        {fade.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-bg to-transparent" />}
        {fade.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-bg to-transparent" />}
        {fade.right && moreLabel && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => box.current?.scrollBy?.({ left: (box.current?.clientWidth ?? 0) * 0.8, behavior: 'smooth' })}
            className="absolute top-2 right-2 chamfer border border-accent bg-panel px-2 py-1 font-display text-xs font-semibold tracking-wider text-accent uppercase shadow"
          >
            {moreLabel}
          </button>
        )}
      </div>
      {footer}
    </div>
  );
}
