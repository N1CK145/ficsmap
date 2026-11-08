import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanStep, Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { GameIcon } from '../machineWiki/icons.js';
import { layoutDiagram, type DiagramEdge, type DiagramNode } from './diagramLayout.js';
import { formatRate, type Lang } from './format.js';
import { StepBadges, StepPicture } from './pictures.js';
import { stepText, type StepText } from './stepText.js';

type EdgeStyle = 'input' | 'byproduct' | 'loop';
const EDGE_STYLES: readonly EdgeStyle[] = ['input', 'byproduct', 'loop'];
const styleOf = (e: DiagramEdge): EdgeStyle => (e.loop ? 'loop' : e.kind);
const STROKE: Record<EdgeStyle, string> = { input: 'stroke-muted', byproduct: 'stroke-free', loop: 'stroke-accent' };
const FILL: Record<EdgeStyle, string> = { input: 'fill-muted', byproduct: 'fill-free', loop: 'fill-accent' };
const TEXT: Record<EdgeStyle, string> = { input: 'text-fg', byproduct: 'text-free', loop: 'text-accent' };
/** Line style is the first cue, colour the second: by-products dotted, loops dashed. */
const DASH: Record<EdgeStyle, string | undefined> = { input: undefined, byproduct: '1 5', loop: '6 4' };

/** The machine picture on a node, and the product's picture pinned to its corner. */
const PICTURE = 48;
const PIN = 20;
/** A node's padding and border around its content, top and bottom (`py-1.5`, a 1 px border; a wanted item's bottom border is 4 px). */
const chrome = (wanted: boolean) => 12 + 1 + (wanted ? 4 : 1);

export interface PlanDiagramProps {
  steps: readonly PlanStep[];
  index: RecipeIndex;
  lang: Lang;
  /** The step whose panel is open. */
  selected: string | null;
  onSelect(item: string): void;
  /** Escape on a node closes the open panel. */
  onDismiss(): void;
  /** The panel's id (aria-controls of the selected node). */
  editorId: string;
  /** The element id of an item's node, so focus can come back to it. */
  nodeId(item: string): string;
  /** The node purity of the settings: a node shows its purity only when it differs. */
  defaultPurity: Purity;
  /** Scaled down to the width of its box ("Fit to width"). */
  fit: boolean;
  /** Whether the diagram is wider than its box (then "Fit to width" is offered). */
  onOverflow(wider: boolean): void;
}

/**
 * The plan as a material flow from top to bottom (layout in `diagramLayout.ts`): raw resources at the top, the wanted
 * items at the bottom. Nodes are buttons with the building's picture (the product pinned to its corner), "4×
 * Constructor", the item and its rate, and badges where there is something to say; each row is as high as its tallest
 * node (measured after rendering). Under them an SVG with the edges and HTML rate labels with the item's picture; the
 * edges of the selected or hovered node stand out. One tab stop; the arrow keys move between nodes (left and right in a
 * row, up and down to the nearest node of the next row). Centred in its box on a dotted canvas; a wider diagram starts
 * at its left edge, with a fade on the side it continues, or is scaled to the box (`fit`). A legend only for by-products,
 * loops and items supplied from outside.
 */
export function PlanDiagram({ steps, index, lang, selected, onSelect, onDismiss, editorId, nodeId, defaultPurity, fit, onOverflow }: PlanDiagramProps) {
  const { t } = useTranslation();
  const stepOf = useMemo(() => new Map(steps.map(s => [s.item, s])), [steps]);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const layout = useMemo(() => layoutDiagram(steps, { heights }), [steps, heights]);
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
  const tabStop = [active, selected].find(i => i !== null && stepOf.has(i)) ?? layout.nodes[0]?.item;
  const zoom = fit && boxWidth > 0 && layout.width > boxWidth ? boxWidth / layout.width : 1;

  // Each row as high as its tallest node: measure the content after rendering, lay out again if it differs (before
  // the browser paints). Not while scaled down, and not where nothing has a size (tests).
  useLayoutEffect(() => {
    if (zoom !== 1) return;
    const next = new Map<string, number>();
    for (const [item, el] of contents.current) {
      const h = el.offsetHeight;
      if (h > 0) next.set(item, h + chrome((stepOf.get(item)?.targetRate ?? 0) > 0));
    }
    if (next.size === 0) return;
    const same = next.size === heights.size && [...next].every(([item, h]) => heights.get(item) === h);
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

  // The edges of the selected and the hovered (or focused) node stand out; with a step selected the others fade.
  const hot = (e: DiagramEdge) => [selected, hover].some(i => i !== null && (e.from === i || e.to === i));
  const look = (e: DiagramEdge) => (hot(e) ? 'hot' : selected !== null ? 'dim' : 'plain');
  const edges = [...layout.edges].sort((a, b) => Number(hot(a)) - Number(hot(b)));
  const texts = new Map(steps.map(s => [s.item, stepText(s, index, lang, t, defaultPurity)]));

  return (
    <div className="flex flex-col">
      <p id={hintId} className="sr-only">{t('planner.diagram.hint')}</p>
      <div className="relative">
        <div ref={box} onScroll={updateFade} className="overflow-x-auto overscroll-x-contain bg-bg bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-size-[24px_24px]">
          <div
            role="group"
            aria-label={t('planner.diagram.label')}
            aria-describedby={hintId}
            className="relative mx-auto"
            style={{ width: layout.width, height: layout.height, ...(zoom !== 1 ? { zoom } : {}) }}
          >
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
              <defs>
                {EDGE_STYLES.map(k => (
                  <marker key={k} id={`${uid}-${k}`} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
                    <path d="M0 0L8 4L0 8z" className={FILL[k]} />
                  </marker>
                ))}
                <marker id={`${uid}-hot`} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
                  <path d="M0 0L8 4L0 8z" className="fill-fg" />
                </marker>
              </defs>
              {edges.map(e => {
                const k = styleOf(e);
                const state = look(e);
                const strong = state === 'hot' && k === 'input';
                return (
                  <path
                    key={`${e.kind}:${e.from}:${e.to}`}
                    d={e.path}
                    fill="none"
                    strokeWidth={state === 'hot' ? 2.5 : 1.5}
                    strokeDasharray={DASH[k]}
                    strokeLinecap={k === 'byproduct' ? 'round' : undefined}
                    markerEnd={`url(#${uid}-${strong ? 'hot' : k})`}
                    data-edge={k}
                    data-from={e.from}
                    data-to={e.to}
                    data-state={state}
                    className={`${strong ? 'stroke-fg' : STROKE[k]} ${state === 'dim' ? 'opacity-50' : ''} motion-safe:transition-opacity`}
                  />
                );
              })}
            </svg>
            {edges.map(e => {
              const item = e.kind === 'input' ? e.from : e.to;
              const state = look(e);
              return (
                <span
                  key={`${e.kind}:${e.from}:${e.to}`}
                  aria-hidden="true"
                  data-label-to={e.to}
                  className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 bg-bg px-1 text-xs leading-5 whitespace-nowrap tabular-nums ${TEXT[styleOf(e)]} ${
                    state === 'hot' ? 'font-semibold' : state === 'dim' ? 'opacity-50' : ''
                  } motion-safe:transition-opacity`}
                  style={{ left: e.label.x, top: e.label.y, maxWidth: e.label.width }}
                >
                  <GameIcon cls={item} px={16} />
                  {formatRate(index, item, e.rate, lang, t)}
                </span>
              );
            })}
            {layout.nodes.map(n => {
              const step = stepOf.get(n.item)!;
              const text = texts.get(n.item)!;
              const isSelected = selected === n.item;
              return (
                <button
                  key={n.item}
                  ref={el => { if (el) buttons.current.set(n.item, el); else buttons.current.delete(n.item); }}
                  id={nodeId(n.item)}
                  type="button"
                  tabIndex={n.item === tabStop ? 0 : -1}
                  aria-label={text.label}
                  aria-expanded={isSelected}
                  aria-controls={isSelected ? editorId : undefined}
                  onClick={() => onSelect(n.item)}
                  onFocus={() => { setActive(n.item); setHover(n.item); }}
                  onBlur={() => setHover(h => (h === n.item ? null : h))}
                  onPointerEnter={() => setHover(n.item)}
                  onPointerLeave={() => setHover(h => (h === n.item ? null : h))}
                  onKeyDown={e => onKeyDown(e, n)}
                  style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
                  className={`absolute flex items-start overflow-hidden chamfer border px-2 py-1.5 text-left text-fg focus-ring motion-safe:transition-colors ${
                    isSelected ? 'border-accent bg-raised' : 'border-edge bg-panel hover:border-muted hover:bg-raised'
                  } ${step.targetRate > 0 ? 'border-b-4 border-b-accent' : ''} ${step.choice.kind === 'external' ? 'border-dashed' : ''}`}
                >
                  <NodeCard
                    step={step}
                    text={text}
                    contentRef={el => { if (el) contents.current.set(n.item, el); else contents.current.delete(n.item); }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        {fade.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-bg to-transparent" />}
        {fade.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-bg to-transparent" />}
      </div>
      <Legend steps={steps} edges={layout.edges} />
    </div>
  );
}

/**
 * A node's content, side by side: the building's picture with the product pinned to it; "4× Constructor" (the exact
 * count as tooltip), the item (wrapping, never cut), its rate and the badges; the by-products or why it is supplied
 * from outside only when there are.
 */
function NodeCard({ step, text, contentRef }: { step: PlanStep; text: StepText; contentRef(el: HTMLElement | null): void }) {
  return (
    <span ref={contentRef} className="flex w-full min-w-0 items-start gap-2.5">
      <StepPicture step={step} px={PICTURE} pin={PIN} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-[15px] leading-[18px] font-semibold tracking-wide break-words uppercase" title={text.exact}>{text.made}</span>
        <span className="text-sm leading-[18px] break-words">{text.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="mr-0.5 font-display text-base leading-5 font-semibold tabular-nums">{text.amount}</span>
          <StepBadges text={text} />
        </span>
        {text.third && <span className="mt-0.5 text-xs leading-4 break-words text-muted">{text.third}</span>}
      </span>
    </span>
  );
}

/** What the special lines and marks of this plan mean; only when it has by-products, loops or items supplied from outside. */
function Legend({ steps, edges }: { steps: readonly PlanStep[]; edges: readonly DiagramEdge[] }) {
  const { t } = useTranslation();
  const styles = EDGE_STYLES.filter(k => edges.some(e => styleOf(e) === k));
  const external = steps.some(s => s.choice.kind === 'external');
  const shards = steps.some(s => s.shards > 0);
  if (!external && !styles.some(k => k !== 'input')) return null;
  return (
    <ul aria-label={t('planner.diagram.legend.label')} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted">
      {styles.map(k => (
        <li key={k} className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="24" height="8" className="shrink-0">
            <line x1="0" y1="4" x2="24" y2="4" strokeWidth={1.5} strokeDasharray={DASH[k]} strokeLinecap={k === 'byproduct' ? 'round' : undefined} className={STROKE[k]} />
          </svg>
          {t(`planner.diagram.legend.${k}`)}
        </li>
      ))}
      {external && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 shrink-0 border border-dashed border-muted bg-panel" />
          {t('planner.diagram.legend.external')}
        </li>
      )}
      {shards && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-shard">◆</span>
          {t('planner.diagram.legend.shard')}
        </li>
      )}
    </ul>
  );
}
