import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanStep, Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { GameIcon } from '../machineWiki/icons.js';
import { diagramLinks, diagramRows, type DiagramDirection, type DiagramLink } from './diagramLayout.js';
import { FlowDiagram, type FlowMarker } from './FlowDiagram.js';
import { formatRate, type Lang } from './format.js';
import { StepBadges, StepPicture, USE_STRIP, UseMark, UseStrip } from './pictures.js';
import { stepText, type StepText, type StepUse } from './stepText.js';

type EdgeStyle = 'input' | 'byproduct' | 'loop';
const EDGE_STYLES: readonly EdgeStyle[] = ['input', 'byproduct', 'loop'];
const styleOf = (e: DiagramLink): EdgeStyle => (e.loop ? 'loop' : e.kind);
const STROKE: Record<EdgeStyle, string> = { input: 'stroke-muted', byproduct: 'stroke-free', loop: 'stroke-accent' };
const FILL: Record<EdgeStyle, string> = { input: 'fill-muted', byproduct: 'fill-free', loop: 'fill-accent' };
const TEXT: Record<EdgeStyle, string> = { input: 'text-fg', byproduct: 'text-free', loop: 'text-accent' };
/** Line style is the first cue, colour the second: by-products dotted, loops dashed. */
const DASH: Record<EdgeStyle, string | undefined> = { input: undefined, byproduct: '1 5', loop: '6 4' };
/** An arrowhead per style, and a larger one in the text colour for the material lines of the hovered or selected step. */
const MARKERS: readonly FlowMarker[] = [...EDGE_STYLES.map(k => ({ key: k, className: FILL[k] })), { key: 'hot', className: 'fill-fg', size: 9 }];

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
  /** Top to bottom (raw resources at the top) or left to right (raw resources on the left). */
  direction: DiagramDirection;
}

/**
 * The plan as a material flow from top to bottom (layout in `diagramLayout.ts`): raw resources at the top, the wanted
 * items at the bottom. Nodes are buttons with the building's picture (the product pinned to its corner), "4×
 * Constructor", the item and its rate, and badges where there is something to say; each row is as high as its tallest
 * node (measured after rendering). Under them an SVG with the edges and HTML rate labels with the item's picture; the
 * edges of the selected or hovered node stand out. One tab stop; the arrow keys move between nodes (left and right in a
 * row, up and down to the nearest node of the next row). Panned and zoomed like a map (`FlowDiagram`); a wider diagram
 * opens with whole nodes of its top row in view. A legend only for by-products, loops, items supplied from outside and
 * Power Shards.
 */
export function PlanDiagram({ steps, index, lang, selected, onSelect, onDismiss, editorId, nodeId, defaultPurity, direction }: PlanDiagramProps) {
  const { t } = useTranslation();
  const stepOf = useMemo(() => new Map(steps.map(s => [s.item, s])), [steps]);
  const nodes = useMemo(() => {
    const rowOf = diagramRows(steps);
    return steps.map(s => ({ id: s.item, row: rowOf.get(s.item)! }));
  }, [steps]);
  const links = useMemo(() => diagramLinks(steps), [steps]);
  const options = useMemo(() => ({ direction }), [direction]);
  const texts = new Map(steps.map(s => [s.item, stepText(s, index, lang, t, defaultPurity)]));
  return (
    <FlowDiagram
      nodes={nodes}
      links={links}
      options={options}
      label={t('planner.diagram.label')}
      hint={t(direction === 'right' ? 'planner.diagram.hintRight' : 'planner.diagram.hint')}
      selected={selected}
      onSelect={onSelect}
      onDismiss={onDismiss}
      editorId={editorId}
      nodeId={nodeId}
      nodeLabel={item => texts.get(item)!.label}
      nodeChrome={item => chrome((stepOf.get(item)?.targetRate ?? 0) > 0)}
      nodeClassName={(item, isSelected) => {
        const step = stepOf.get(item)!;
        return `px-2 py-1.5 ${isSelected ? 'border-accent bg-raised' : 'border-edge bg-panel hover:border-muted hover:bg-raised'} ${
          step.targetRate > 0 ? 'border-b-4 border-b-accent' : ''} ${step.choice.kind === 'external' ? 'border-dashed' : ''}`;
      }}
      renderNode={(item, contentRef) => {
        const text = texts.get(item)!;
        return (
          <>
            {text.use && <UseStrip use={text.use} />}
            <NodeCard step={stepOf.get(item)!} text={text} contentRef={contentRef} />
          </>
        );
      }}
      markers={MARKERS}
      edgeKey={e => `${e.kind}:${e.from}:${e.to}`}
      edgeLook={(e, state) => {
        const k = styleOf(e);
        const strong = state === 'hot' && k === 'input';
        return {
          kind: k, marker: strong ? 'hot' : k, className: strong ? 'stroke-fg' : STROKE[k], width: state === 'hot' ? 2.5 : 1.5,
          dash: DASH[k], linecap: k === 'byproduct' ? 'round' : undefined, labelClassName: TEXT[k],
        };
      }}
      renderLabel={e => {
        const item = e.kind === 'input' ? e.from : e.to;
        return (
          <>
            <GameIcon cls={item} px={16} />
            {formatRate(index, item, e.rate, lang, t)}
          </>
        );
      }}
      footer={<Legend steps={steps} links={links} uses={[...texts.values()].flatMap(x => (x.use ? [x.use] : []))} />}
    />
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
          {text.use && <UseMark use={text.use} className="mr-0.5 text-sm leading-5" />}
          <StepBadges text={text} />
        </span>
        {text.third && <span className="mt-0.5 text-xs leading-4 break-words text-muted">{text.third}</span>}
      </span>
    </span>
  );
}

const USE_BANDS: readonly StepUse['band'][] = ['full', 'high', 'throttled'];

/**
 * What the special lines and marks of this plan mean; only when it has by-products, loops, items supplied from outside,
 * Power Shards or steps whose buildings are not all fully used (then the use bands it has).
 */
function Legend({ steps, links, uses }: { steps: readonly PlanStep[]; links: readonly DiagramLink[]; uses: readonly StepUse[] }) {
  const { t } = useTranslation();
  const styles = EDGE_STYLES.filter(k => links.some(e => styleOf(e) === k));
  const external = steps.some(s => s.choice.kind === 'external');
  const shards = steps.some(s => s.shards > 0);
  const bands = uses.some(u => u.band !== 'full') ? USE_BANDS.filter(b => uses.some(u => u.band === b)) : [];
  if (!external && !shards && bands.length === 0 && !styles.some(k => k !== 'input')) return null;
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
      {bands.map(b => (
        <li key={b} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-3 w-1 shrink-0 ${USE_STRIP[b]}`} />
          {t(`planner.use.${b}`)}
        </li>
      ))}
      {shards && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-shard">◆</span>
          {t('planner.diagram.legend.shard')}
        </li>
      )}
    </ul>
  );
}
