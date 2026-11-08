import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { PURITY_FACTOR, type PlanStep } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { buildingName } from './controls.js';
import { layoutDiagram, type DiagramEdge, type DiagramNode } from './diagramLayout.js';
import { formatNumber, formatRate, itemName, type Lang } from './format.js';
import { Picture, stepPicture } from './pictures.js';

type EdgeStyle = 'input' | 'byproduct' | 'loop';
const EDGE_STYLES: readonly EdgeStyle[] = ['input', 'byproduct', 'loop'];
const styleOf = (e: DiagramEdge): EdgeStyle => (e.loop ? 'loop' : e.kind);
const STROKE: Record<EdgeStyle, string> = { input: 'stroke-muted', byproduct: 'stroke-free', loop: 'stroke-accent' };
const FILL: Record<EdgeStyle, string> = { input: 'fill-muted', byproduct: 'fill-free', loop: 'fill-accent' };
const TEXT: Record<EdgeStyle, string> = { input: 'text-fg', byproduct: 'text-free', loop: 'text-accent' };
/** Line style is the first cue, colour the second: by-products dotted, loops dashed. */
const DASH: Record<EdgeStyle, string | undefined> = { input: undefined, byproduct: '1 5', loop: '6 4' };

/** "Alternate: Cast Screw" -> "Cast Screw"; the card marks alternates itself. */
const ALT_PREFIX = /^[^:]{1,16}:\s+/;

/** Size of the machine picture on a node (on a tile 8 px larger). */
const PICTURE = 56;

export interface PlanDiagramProps {
  steps: readonly PlanStep[];
  index: RecipeIndex;
  lang: Lang;
  /** The step whose editor is open. */
  selected: string | null;
  onSelect(item: string): void;
  /** The editor's id (aria-controls of the selected node). */
  editorId: string;
  /** The element id of an item's node, so focus can come back to it. */
  nodeId(item: string): string;
}

/**
 * The plan as a material flow from top to bottom (layout in `diagramLayout.ts`): raw resources at the top, the wanted
 * items at the bottom. Nodes are buttons showing the step's machine picture, "4× Constructor" and what it makes, over
 * an SVG with the edges and HTML rate labels. One tab stop; the arrow keys move between nodes (left and right in a
 * row, up and down to the nearest node of the next row). Centred on the page; scrolls sideways when it is wider.
 */
export function PlanDiagram({ steps, index, lang, selected, onSelect, editorId, nodeId }: PlanDiagramProps) {
  const { t } = useTranslation();
  const layout = useMemo(() => layoutDiagram(steps), [steps]);
  const stepOf = useMemo(() => new Map(steps.map(s => [s.item, s])), [steps]);
  const byRow = useMemo(() => {
    const rows: DiagramNode[][] = Array.from({ length: layout.rows }, () => []);
    for (const n of layout.nodes) rows[n.row]!.push(n);
    return rows;
  }, [layout]);
  const [active, setActive] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // Marker ids go into url(#…): letters, digits, - and _ only.
  const uid = useId().replace(/[^\w-]/g, '');
  const tabStop = [active, selected].find(i => i !== null && stepOf.has(i)) ?? layout.nodes[0]?.item;

  function onKeyDown(e: KeyboardEvent, n: DiagramNode) {
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

  const dim = (e: DiagramEdge) => (selected !== null && e.from !== selected && e.to !== selected ? 'opacity-30' : '');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t('planner.diagram.hint')}</p>
      <div className="overflow-x-auto overscroll-x-contain rounded border border-line bg-bg">
        <div role="group" aria-label={t('planner.diagram.label')} className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
            <defs>
              {EDGE_STYLES.map(k => (
                <marker key={k} id={`${uid}-${k}`} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
                  <path d="M0 0L8 4L0 8z" className={FILL[k]} />
                </marker>
              ))}
            </defs>
            {layout.edges.map(e => {
              const k = styleOf(e);
              return (
                <path
                  key={`${e.kind}:${e.from}:${e.to}`}
                  d={e.path}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={DASH[k]}
                  strokeLinecap={k === 'byproduct' ? 'round' : undefined}
                  markerEnd={`url(#${uid}-${k})`}
                  data-edge={k}
                  data-from={e.from}
                  data-to={e.to}
                  className={`${STROKE[k]} ${dim(e)} motion-safe:transition-opacity`}
                />
              );
            })}
          </svg>
          {layout.edges.map(e => (
            <span
              key={`${e.kind}:${e.from}:${e.to}`}
              aria-hidden="true"
              data-label-to={e.to}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 truncate rounded bg-bg px-1 text-[11px] leading-4 tabular-nums ${TEXT[styleOf(e)]} ${dim(e)} motion-safe:transition-opacity`}
              style={{ left: e.label.x, top: e.label.y, maxWidth: e.label.width }}
            >
              {formatRate(index, e.kind === 'input' ? e.from : e.to, e.rate, lang, t)}
            </span>
          ))}
          {layout.nodes.map(n => {
            const step = stepOf.get(n.item)!;
            const text = nodeText(step, index, lang, t);
            const isSelected = selected === n.item;
            const wanted = step.targetRate > 0;
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
                onFocus={() => setActive(n.item)}
                onKeyDown={e => onKeyDown(e, n)}
                style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
                className={`absolute flex flex-col items-center overflow-hidden rounded border px-2 pt-2 text-center text-fg focus-ring motion-safe:transition-colors ${
                  isSelected ? 'border-accent bg-line' : 'border-line bg-panel hover:border-muted'
                } ${wanted ? 'border-b-4 border-b-accent pb-0.5' : 'pb-1.5'} ${step.choice.kind === 'external' ? 'border-dashed' : ''}`}
              >
                <NodeCard step={step} text={text} />
              </button>
            );
          })}
        </div>
      </div>
      <Legend />
    </div>
  );
}

const badge = 'shrink-0 rounded border px-1 text-[11px] leading-4';
const TONE = { muted: 'border-line text-muted', accent: 'border-accent text-accent', free: 'border-free text-free' } as const;

/** A compact badge on the card; `long` is its title and goes into the node's accessible name (`parts`, or `long`). */
interface Badge { text: string; shards?: number; long: string; parts?: string[]; tone: keyof typeof TONE }

/** What a node says: shown on the card, and as one sentence for its accessible name. */
function nodeText(step: PlanStep, index: RecipeIndex, lang: Lang, t: TFunction) {
  const name = itemName(index, step.item, lang);
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const external = step.choice.kind === 'external';
  const covered = !external && step.machines < 1e-9;
  const exact = !external && !covered && Math.abs(step.machines - step.machinesCeil) > 1e-6
    ? t('planner.exact', { value: formatNumber(step.machines, lang, 3) }) : undefined;
  let made: string;
  if (external) made = t('planner.option.external');
  else if (covered) made = t('planner.diagram.covered');
  else made = t('planner.diagram.machines', { count: step.machinesCeil, name: buildingName(step, index, lang) ?? '' });
  const amount = rate(step.item, covered ? step.fromByproducts : step.rate);
  const byproducts = step.byproducts.filter(f => f.rate > 1e-9).map(f => ({ name: itemName(index, f.item, lang), amount: rate(f.item, f.rate) }));

  // The recipe or the node purity (badge), or why it is supplied from outside (third line).
  let how: { text: string; long: string; alt: boolean } | undefined;
  if (step.recipe) {
    const full = step.recipe.name[lang];
    const alt = step.recipe.alternate;
    const text = alt ? full.replace(ALT_PREFIX, '') : full;
    how = { text, long: alt ? t('planner.diagram.alternate', { recipe: text }) : full, alt };
  } else if (step.auto === 'loop') {
    how = { text: t('planner.diagram.autoLoop'), long: t('planner.autoLoop'), alt: false };
  }

  const badges: Badge[] = [];
  if (how?.alt) badges.push({ text: t('planner.diagram.alt'), long: how.long, parts: [], tone: 'accent' });
  if (step.purity) {
    const text = t(`planner.purityOption.${step.purity}`, { factor: PURITY_FACTOR[step.purity] });
    badges.push({ text, long: `${t('planner.purity')}: ${text}`, tone: 'muted' });
  }
  const clock = step.clock * 100;
  if (!external && (Math.abs(clock - 100) > 1e-6 || step.shards > 0)) {
    const parts = [t('planner.diagram.clockLong', { value: clock })];
    if (step.shards > 0) {
      const pressurizer = step.pressurizer ? index.data.wellPressurizer?.name[lang] : undefined;
      parts.push(pressurizer ? t('planner.shardsPressurizer', { count: step.shards, name: pressurizer }) : t('planner.shards', { count: step.shards }));
    }
    badges.push({ text: t('planner.diagram.clock', { value: clock }), shards: step.shards, long: parts.join(' · '), parts, tone: 'muted' });
  }
  if (!covered && step.fromByproducts > 1e-9) {
    badges.push({ text: t('planner.diagram.byproducts'), long: t('planner.fromByproducts', { value: rate(step.item, step.fromByproducts) }), tone: 'free' });
  }

  const loop = step.cycle ? { text: t('planner.cycle'), long: t('planner.cycleHint') } : undefined;
  const third = step.auto === 'loop' ? how?.text : byproducts.map(b => `+ ${b.name} · ${b.amount}`).join(', ') || undefined;

  const needs = step.inputs.filter(f => f.rate > 1e-9).map(f => `${rate(f.item, f.rate)} ${itemName(index, f.item, lang)}`);
  const label = [
    step.targetRate > 0 ? `${name} (${t('planner.diagram.wanted', { value: rate(step.item, step.targetRate) })})` : name,
    exact ? `${made} (${exact})` : made,
    external || covered ? amount : t('planner.diagram.makes', { value: amount }),
    byproducts.length > 0 ? `${t('planner.byproducts')}: ${byproducts.map(b => `${b.amount} ${b.name}`).join(', ')}` : undefined,
    how?.long,
    loop?.long,
    ...badges.flatMap(b => b.parts ?? [b.long]),
    needs.length > 0 ? t('planner.diagram.needs', { list: needs.join(', ') }) : undefined,
  ].filter(Boolean).join('; ');
  return { name, made, exact, amount, third, loop, badges, label, wanted: step.targetRate > 0 ? rate(step.item, step.targetRate) : undefined };
}

/** A node's content: the machine picture; "4× Constructor"; item and rate; by-products; badges. */
function NodeCard({ step, text }: { step: PlanStep; text: ReturnType<typeof nodeText> }) {
  const { t } = useTranslation();
  const picture = stepPicture(step);
  return (
    <>
      {text.loop && <span className={`absolute right-1.5 top-1.5 max-w-[60px] truncate ${badge} ${TONE.accent}`} title={text.loop.long}>{text.loop.text}</span>}
      <Picture cls={picture.cls} px={PICTURE} dashed={picture.dashed} />
      <span className="mt-1 w-full truncate text-sm font-semibold leading-5" title={text.exact}>{text.made}</span>
      <span className="flex w-full min-w-0 justify-center gap-1 text-xs leading-4" title={`${text.name} · ${text.amount}`}>
        <span className="truncate">{text.name}</span>
        <span aria-hidden="true" className="text-muted">·</span>
        <span className="shrink-0 tabular-nums">{text.amount}</span>
      </span>
      <span className="h-4 w-full truncate text-[11px] leading-4 text-muted" title={text.third}>{text.third}</span>
      <span className="mt-1 flex h-[18px] w-full justify-center gap-1 overflow-hidden">
        {text.wanted && (
          <span className="shrink-0 rounded bg-accent px-1 text-[11px] font-semibold leading-4 text-bg" title={t('planner.diagram.wanted', { value: text.wanted })}>
            {t('planner.diagram.wantedBadge')}
          </span>
        )}
        {text.badges.map(b => (
          <span key={b.long} className={`${badge} ${TONE[b.tone]}`} title={b.long}>
            <span>{b.text}</span>
            {b.shards ? <span aria-hidden="true" className="ml-0.5 text-shard">{'◆'.repeat(b.shards)}</span> : null}
          </span>
        ))}
      </span>
    </>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <ul aria-label={t('planner.diagram.legend.label')} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {EDGE_STYLES.map(k => (
        <li key={k} className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="24" height="8" className="shrink-0">
            <line x1="0" y1="4" x2="24" y2="4" strokeWidth={1.5} strokeDasharray={DASH[k]} strokeLinecap={k === 'byproduct' ? 'round' : undefined} className={STROKE[k]} />
          </svg>
          {t(`planner.diagram.legend.${k}`)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 shrink-0 rounded border border-b-4 border-line border-b-accent bg-panel" />
        {t('planner.diagram.legend.wanted')}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 shrink-0 rounded border border-dashed border-muted bg-panel" />
        {t('planner.diagram.legend.external')}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-shard">◆</span>
        {t('planner.diagram.legend.shard')}
      </li>
    </ul>
  );
}
