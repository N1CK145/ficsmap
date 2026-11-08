import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { bandOf, lostOf, REASONS, type AnalysisData, type FactoryAnalysis } from '../../../shared/factory/analysis.js';
import type { LineGroup, LineRate, ProductionLine } from '../../../shared/factory/lines.js';
import type { WorldCtx } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { badgeClass } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { FlowIcon, MapIcon } from '../../components/icons.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { Window } from '../../components/Window.js';
import { useImportDialog } from '../import/ImportDialog.js';
import { prefersReducedMotion } from '../map/motion.js';
import { GameIcon } from '../machineWiki/icons.js';
import type { DiagramEdge, DiagramOptions } from '../planner/diagramLayout.js';
import { FlowDiagram, type EdgeLook, type EdgeState, type FlowMarker } from '../planner/FlowDiagram.js';
import { Picture, PinnedPicture } from '../planner/pictures.js';
import { prettyClass, type FactoryLabels, type SnapshotAnalysis } from './data.js';
import type { FactoryFormat } from './format.js';
import { FullIcon } from './icons.js';
import { MachineLine } from './ItemsSection.js';
import {
  bottleneckOf, compactLine, groupsTopDown, hasProblemBottleneck, isSaturated, LINE_PARAM, lineGraph, loadOf, MACHINES_ONLY_ABOVE, machinesOnly, mainOutput,
  NODE_WIDTH, throughGroups, type LineLink, type LineLinkKind,
} from './lineDiagram.js';
import { ProductivityBar, ReasonBadge, ShowOnMap, STATE_TEXT } from './parts.js';
import { useFactoryPage } from './timeline.js';
import { useProductionLines } from './useLines.js';
import { useFactoryView } from './view.js';

/** A phone (below Tailwind's `sm`): the diagram is not fitted to the width there, and the groups show as a list. */
const PHONE_QUERY = '(max-width: 639px)';
/** Lines listed before "Show all". */
const FIRST_LINES = 8;
/** The labels carry the rate and the capacity ("112.5/min of 120"), so they get more room than the planner's. */
const OPTIONS: Partial<DiagramOptions> = { nodeWidth: NODE_WIDTH, labelWidth: 176, portGap: 128 };
/** A node's padding and border around its content (`py-1.5`, 1 px borders). */
const CHROME = 12 + 2;

/** The productivity strip on the left of a machine group, in its state's colour (the % beside the bar says it too). */
const STATE_EDGE: Record<LineGroup['state'], string> = {
  idle: 'border-l-conflict', throttled: 'border-l-accent', high: 'border-l-power', full: 'border-l-free', paused: 'border-l-edge',
};

type View = 'diagram' | 'map';

/** Picture class of a group: its building's, or none for a logistics kind that is no class. */
const isClass = (cls: string) => /^(Build|BP)_/.test(cls);

/** Everything the parts of the section need to name things. */
interface Names {
  labels: FactoryLabels;
  fmt: FactoryFormat;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/** "4× Constructor"; a single logistics node just by name ("Conveyor Merger"). */
function groupName(g: LineGroup, { labels, fmt, t }: Names): string {
  const name = isClass(g.cls) ? labels.building(g.cls, fmt.lang) : t(`factory.lines.kind.${g.kind ?? g.cls}`, { defaultValue: prettyClass(g.cls) });
  return g.logistics && g.members.length === 1 ? name : t('factory.lines.groupTitle', { count: g.members.length, name });
}

const fluidOf = (r: LineRate, labels: FactoryLabels) => r.fluid ?? labels.isFluid(r.item);

/** "12.0/min of 15.0/min" for a group's main product, or just the actual rate without a nominal one. */
function groupRate(g: LineGroup, { labels, fmt, t }: Names): string | null {
  const out = g.outputs[0];
  if (!out) return null;
  const fluid = fluidOf(out, labels);
  const nominal = g.nominal.find(n => n.item === out.item);
  return nominal ? t('factory.lines.rateOf', { actual: fmt.rate(out.perMin, fluid), nominal: fmt.rate(nominal.perMin, fluid) }) : fmt.rate(out.perMin, fluid);
}

/** A capacity as a whole number where it is one ("120"), else with one decimal. */
const capacityText = (n: number, fmt: FactoryFormat) => (Math.abs(n - Math.round(n)) < 0.05 ? fmt.int(Math.round(n)) : fmt.num1(n));

/** The line's name: its products ("Copper Sheet, Wire +1"), else its last group. */
function lineName(line: ProductionLine, names: Names): string {
  const products = line.products.map(p => names.labels.item(p.item, names.fmt.lang));
  if (products.length === 0) {
    // Its most downstream machine names it (the line's id).
    const last = line.groups.find(g => g.members.includes(line.id)) ?? groupsTopDown(line).filter(g => !g.logistics).at(-1);
    return last ? groupName(last, names) : line.id;
  }
  return products.length > 2 ? names.t('factory.lines.more', { list: products.slice(0, 2).join(', '), count: products.length - 2 }) : products.join(', ');
}

/** A line without products (it ends in generators or makes nothing yet): the picture of the building naming it. */
function linePicture(line: ProductionLine, labels: FactoryLabels): string {
  const g = line.groups.find(x => x.members.includes(line.id));
  return g && isClass(g.cls) ? labels.buildingPicture(g.cls) : '';
}

/** The bottleneck in one sentence ("Bottleneck: Conveyor Belt Mk.2 between 4× Smelter and 2× Constructor (120.0/min of 120)"). */
function bottleneckText(line: ProductionLine, names: Names): string | null {
  const { labels, fmt, t } = names;
  const b = line.bottleneck;
  if (!b) return null;
  const group = (id: string) => {
    const g = line.groups.find(x => x.id === id);
    return g ? groupName(g, names) : id;
  };
  if (b.kind === 'edge') {
    const e = line.edges[b.edge];
    if (!e) return null;
    const fluid = e.item ? labels.isFluid(e.item) : false;
    const belt = e.slowest ? labels.building(e.slowest, fmt.lang) : t('factory.lines.connection');
    const flow = e.perMin !== undefined && e.capacity
      ? t('factory.lines.rateOfCapacity', { rate: fmt.rate(e.perMin, fluid), capacity: capacityText(e.capacity, fmt) })
      : null;
    const parts = { belt, from: group(e.from), to: group(e.to) };
    return flow ? t('factory.lines.bottleneck.edgeFlow', { ...parts, flow }) : t('factory.lines.bottleneck.edge', parts);
  }
  const why = b.why === 'demand' ? t('factory.lines.bottleneck.demand') : t(`factory.reason.${b.why}`);
  return t('factory.lines.bottleneck.group', { group: group(b.group), why });
}

/** Where the selected line's diagram is opened from the map: the query parameter, else the page's own choice. */
function useLineChoice(lines: readonly ProductionLine[] | undefined) {
  const [params, setParams] = useSearchParams();
  const param = params.get(LINE_PARAM);
  const stored = useFactoryPage(s => s.line);
  const setLine = useFactoryPage(s => s.setLine);
  useEffect(() => { if (param !== null && param !== stored) setLine(param); }, [param, stored, setLine]);
  const wanted = param ?? stored;
  const line = lines?.find(l => l.id === wanted) ?? lines?.[0];
  const choose = (id: string) => {
    setLine(id);
    setParams(p => { const next = new URLSearchParams(p); next.set(LINE_PARAM, id); return next; }, { replace: true, preventScrollReset: true });
  };
  return { line, choose, linked: param };
}

/**
 * "Production lines" on the factory page: the factory's machines grouped by how belts and pipes really connect them
 * (`buildLines`), as a list (products, machines, mean productivity, a bottleneck badge) and the chosen line's diagram,
 * drawn like the planner's (`FlowDiagram`): groups of parallel machines as nodes with their productivity, the belts and
 * pipes between them with the flow, the capacity of the slowest piece and how full it is. The switch "Diagram | Map"
 * in the title bar shows the line on the factory map (`selectLine` in the shared view); `?line=<id>` opens a line here
 * (`linePath`). A save without connections (imported before they were read) says to import it again.
 */
export function LinesSection({ ctx, shown, data, labels, fmt }: {
  ctx: WorldCtx; shown: SnapshotAnalysis; data: AnalysisData; labels: FactoryLabels; fmt: FactoryFormat;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectLine = useFactoryView(s => s.selectLine);
  const result = useProductionLines(shown, data);
  const lines = result?.lines;
  const { line, choose, linked } = useLineChoice(lines);
  const phone = useMediaQuery(PHONE_QUERY);
  const [fit, setFit] = useState(false);
  const [wider, setWider] = useState(false);
  const names: Names = { labels, fmt, t };
  const hasLinks = (shown.snapshot.links?.length ?? 0) > 0;
  const machines = lines?.reduce((s, l) => s + l.machines.length, 0) ?? 0;

  // Opened from the map (`?line=`): scroll the section into view once the lines are there.
  const box = useRef<HTMLDivElement>(null);
  const arrived = useRef(linked);
  const ready = Boolean(lines?.length);
  useEffect(() => {
    if (!ready || arrived.current === null) return;
    arrived.current = null;
    box.current?.scrollIntoView?.({ block: 'start' });
  }, [ready]);

  const toMap = (v: View) => {
    if (v !== 'map' || !line) return;
    selectLine(line.id);
    void navigate(worldPath(ctx.worldId));
  };
  const views = [
    { value: 'diagram' as const, label: <span className="inline-flex items-center gap-1.5"><FlowIcon /><span className="max-[399px]:sr-only">{t('factory.lines.viewDiagram')}</span></span> },
    { value: 'map' as const, label: <span className="inline-flex items-center gap-1.5"><MapIcon /><span className="max-[399px]:sr-only">{t('factory.lines.viewMap')}</span></span> },
  ];
  const actions = line ? (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {!phone && (wider || fit) && (
        <Button size="sm" variant="ghost" onClick={() => setFit(f => !f)}>{fit ? t('planner.diagram.actualSize') : t('planner.diagram.fit')}</Button>
      )}
      <SegmentedControl<View> label={t('factory.lines.view')} options={views} value="diagram" onChange={toMap} />
    </span>
  ) : undefined;

  let body: ReactNode;
  if (!hasLinks) body = <NoLinks ctx={ctx} />;
  else if (lines === undefined) body = <p className="p-3 text-sm text-muted">{t('common.loading')}</p>;
  else if (lines.length === 0 || !line) body = <p className="p-3 text-sm text-muted">{t('factory.lines.none')}</p>;
  else {
    body = (
      <div className="flex flex-col lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]">
        <LineList lines={lines} current={line.id} onChoose={choose} names={names} />
        <LineView
          key={`${shown.snapshot.meta.saveTime}:${line.id}`}
          worldId={ctx.worldId} line={line} analysis={shown.analysis} names={names} fit={fit && !phone} onOverflow={setWider} phone={phone}
          recipeName={(id: string) => data.recipes.recipes.get(id)?.name[fmt.lang]}
        />
      </div>
    );
  }

  return (
    <div ref={box} id="factory-lines" className="scroll-mt-3">
      <Window
        title={t('factory.lines.title')}
        subtitle={lines?.length ? t('factory.lines.subtitle', { count: lines.length, machines }) : undefined}
        actions={actions}
        bodyClassName="p-0"
      >
        {body}
      </Window>
    </div>
  );
}

/** A save extracted before connections were read: import it again. The owner gets the import dialog. */
function NoLinks({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  return (
    <div className="flex flex-col items-start gap-2 p-3 text-sm">
      <p>{t('factory.lines.noLinks')}</p>
      {ctx.world.isOwner
        ? <Button size="sm" onClick={() => show()}>{t('factory.lines.reimport')}</Button>
        : <p className="text-muted">{t('factory.lines.noLinksMember', { owner: ctx.world.owner.displayName })}</p>}
    </div>
  );
}

/** The lines as a list of buttons: product pictures, name, machines, mean productivity, a bottleneck badge. */
function LineList({ lines, current, onChoose, names }: { lines: readonly ProductionLine[]; current: string; onChoose(id: string): void; names: Names }) {
  const { t, fmt } = names;
  const [all, setAll] = useState(false);
  const head = all ? lines : lines.slice(0, FIRST_LINES);
  // The chosen line stays listed even beyond the first ones (opened from the map).
  const chosen = lines.find(l => l.id === current);
  const shown = chosen && !head.includes(chosen) ? [...head, chosen] : head;
  return (
    <div className="flex flex-col border-line max-lg:border-b lg:border-r">
      <ul aria-label={t('factory.lines.listLabel')} className="flex flex-col divide-y divide-line">
        {shown.map(l => {
          const pressed = l.id === current;
          const band = bandOf(l.productivity);
          return (
            <li key={l.id}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => onChoose(l.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left focus-ring max-[899px]:min-h-11 ${pressed ? 'bg-raised shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-raised'}`}
              >
                <span className="flex shrink-0 -space-x-2">
                  {(l.products.length > 0 ? l.products.slice(0, 3).map(p => p.item) : [linePicture(l, names.labels)]).map(cls => (
                    <Picture key={cls} cls={cls} px={24} className="border border-line" />
                  ))}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium break-words">{lineName(l, names)}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted max-[899px]:text-sm">
                    <span>{t('factory.machines.count', { count: l.machines.length })}</span>
                    <ProductivityBar value={l.productivity} band={band} fmt={fmt} className="text-xs" />
                    {hasProblemBottleneck(l) && <span className={badgeClass('accent')}>{t('factory.lines.bottleneck.badge')}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {lines.length > FIRST_LINES && (
        <div className="border-t border-line p-2">
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? t('factory.showFewer') : t('factory.showAll', { count: lines.length })}
          </Button>
        </div>
      )}
    </div>
  );
}

const MARKERS: readonly FlowMarker[] = [
  { key: 'low', className: 'fill-edge' }, { key: 'mid', className: 'fill-muted' }, { key: 'fg', className: 'fill-fg', size: 9 },
  { key: 'full', className: 'fill-accent', size: 10 }, { key: 'byproduct', className: 'fill-free' },
];

/** Line style is the first cue, colour the second: by-products dotted, loops dashed, as in the planner. */
const DASH: Record<LineLinkKind, string | undefined> = { flow: undefined, byproduct: '1 5', loop: '6 4' };

/**
 * One line: the bottleneck in a sentence, on a phone its groups as a list, the diagram, its legend and, for a selected
 * group, its machines.
 */
function LineView({ worldId, line: full, analysis, names, fit, onOverflow, phone, recipeName }: {
  worldId: string; line: ProductionLine; analysis: FactoryAnalysis; names: Names; fit: boolean; onOverflow(wider: boolean): void; phone: boolean;
  recipeName(id: string): string | undefined;
}) {
  const { t, labels, fmt } = names;
  const compact = useMemo(() => compactLine(full), [full]);
  const machinesChoice = useFactoryPage(s => s.machinesOnly);
  const setMachinesOnly = useFactoryPage(s => s.setMachinesOnly);
  const hasPassThrough = useMemo(() => throughGroups(compact.line).size > 0, [compact]);
  // Large lines open with their machines only, until the switch is used.
  const onlyMachines = hasPassThrough && (machinesChoice ?? compact.line.groups.length > MACHINES_ONLY_ABOVE);
  const line = useMemo(() => (onlyMachines ? machinesOnly(compact.line) : compact.line), [onlyMachines, compact]);
  const hidden = onlyMachines ? 0 : compact.hidden;
  const graph = useMemo(() => lineGraph(line), [line]);
  const groupOf = useMemo(() => new Map(line.groups.map(g => [g.id, g])), [line]);
  const [selected, setSelected] = useState<string | null>(null);
  const editorId = useId();
  const nodePrefix = useId();
  const nodeId = (id: string) => `${nodePrefix}${id}`;
  const bottleneck = bottleneckOf(line);
  // The bottleneck as the line names it, also where the diagram leaves its belt out.
  const sentence = bottleneckText(full, names);
  const name = lineName(line, names);
  const group = selected ? groupOf.get(selected) : undefined;
  const panel = useRef<HTMLDivElement>(null);

  const onSelect = (id: string) => setSelected(s => (s === id ? null : id));
  useEffect(() => {
    if (selected) panel.current?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [selected]);
  function close() {
    if (selected) {
      const node = document.getElementById(nodeId(selected));
      node?.focus({ preventScroll: true });
      node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    setSelected(null);
  }

  const edgeOf = (e: DiagramEdge<LineLink>) => line.edges[e.edge]!;
  const edgeLook = (e: DiagramEdge<LineLink>, state: EdgeState): EdgeLook => {
    const edge = edgeOf(e);
    const full = isSaturated(edge);
    const load = loadOf(edge);
    const isBottleneck = bottleneck.edgeIndex === e.edge;
    const width = (isBottleneck ? 4.5 : full ? 3.5 : 1.25 + 2 * Math.min(1, load ?? 0.25)) + (state === 'hot' ? 1 : 0);
    if (e.kind === 'byproduct') {
      return { kind: e.kind, marker: 'byproduct', className: 'stroke-free', width, dash: DASH.byproduct, linecap: 'round', labelClassName: 'text-free' };
    }
    const tone = full || isBottleneck ? 'full' : state === 'hot' ? 'fg' : load !== null && load < 0.5 ? 'low' : 'mid';
    const stroke = { full: 'stroke-accent', fg: 'stroke-fg', low: 'stroke-edge', mid: 'stroke-muted' }[tone];
    return {
      kind: full ? 'saturated' : e.kind, marker: tone, className: stroke, width, dash: DASH[e.kind],
      labelClassName: full || isBottleneck ? 'text-accent' : e.kind === 'loop' ? 'text-accent' : 'text-fg',
    };
  };
  const renderLabel = (e: DiagramEdge<LineLink>) => {
    const edge = edgeOf(e);
    const fluid = edge.item ? labels.isFluid(edge.item) : false;
    const full = isSaturated(edge);
    return (
      <>
        {edge.items && edge.items.length > 1
          ? edge.items.slice(0, 3).map(r => <GameIcon key={r.item} cls={r.item} px={16} />)
          : edge.item && <GameIcon cls={edge.item} px={16} />}
        {edge.perMin !== undefined && <span>{fmt.rate(edge.perMin, fluid)}</span>}
        {edge.capacity !== undefined && <span className="font-normal text-muted">{' '}{t('factory.lines.of', { value: capacityText(edge.capacity, fmt) })}</span>}
        {full && <span className="text-accent" data-full><FullIcon /></span>}
      </>
    );
  };

  return (
    <div className="flex min-w-0 flex-col">
      {(sentence || hasPassThrough) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
          {sentence ? (
            <p data-bottleneck className="flex min-w-0 items-start gap-2 py-0.5 text-sm">
              <span aria-hidden="true" className="mt-1 h-2.5 w-6 shrink-0 hazard" />
              <span>{sentence}</span>
            </p>
          ) : <span />}
          {hasPassThrough && (
            <Button size="sm" variant="ghost" aria-pressed={onlyMachines} onClick={() => setMachinesOnly(!onlyMachines)} className="ml-auto">
              <span aria-hidden="true" className={`inline-block size-3 border ${onlyMachines ? 'border-accent bg-accent' : 'border-muted'}`} />
              {t('factory.lines.machinesOnly')}
            </Button>
          )}
        </div>
      )}
      {phone && <GroupList line={line} names={names} selected={selected} onSelect={onSelect} editorId={editorId} bottleneck={bottleneck.group} />}
      <FlowDiagram<LineLink>
        nodes={graph.nodes}
        links={graph.links}
        options={OPTIONS}
        label={t('factory.lines.diagram.label', { name })}
        hint={t('factory.lines.diagram.hint')}
        selected={selected}
        onSelect={onSelect}
        onDismiss={close}
        editorId={editorId}
        nodeId={nodeId}
        fit={fit}
        onOverflow={onOverflow}
        nodeLabel={id => groupLabel(groupOf.get(id)!, names, bottleneck.group === id)}
        nodeChrome={() => CHROME}
        nodeClassName={(id, isSelected) => {
          const g = groupOf.get(id)!;
          const frame = isSelected ? 'border-accent bg-raised' : g.logistics ? 'border-line bg-bg hover:border-muted hover:bg-raised' : 'border-edge bg-panel hover:border-muted hover:bg-raised';
          return `px-2 py-1.5 ${frame} ${g.logistics ? 'items-center!' : `border-l-4 ${STATE_EDGE[g.state]}`}`;
        }}
        renderNode={(id, contentRef) => {
          const g = groupOf.get(id)!;
          return g.logistics
            ? <LogisticsCard group={g} names={names} contentRef={contentRef} />
            : <GroupCard group={g} names={names} contentRef={contentRef} bottleneck={bottleneck.group === id} />;
        }}
        markers={MARKERS}
        edgeKey={e => `${e.edge}`}
        edgeLook={edgeLook}
        renderLabel={renderLabel}
        footer={<Legend line={line} links={graph.links} hasBottleneck={Boolean(line.bottleneck)} hidden={hidden} estimated={onlyMachines} names={names} />}
      />
      {group && (
        <div ref={panel} id={editorId} className="border-t border-line" onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
          <GroupPanel worldId={worldId} group={group} analysis={analysis} names={names} onClose={close} recipeName={recipeName} />
        </div>
      )}
    </div>
  );
}

/** A node's accessible name: "4× Constructor, Copper Sheet, 12.0/min of 15.0/min, 80 %, Part load, Shortage 2". */
function groupLabel(g: LineGroup, names: Names, bottleneck: boolean): string {
  const { t, labels, fmt } = names;
  const out = mainOutput(g);
  const parts = [groupName(g, names)];
  if (out) parts.push(labels.item(out, fmt.lang));
  const rate = groupRate(g, names);
  if (rate) parts.push(rate);
  if (!g.logistics) parts.push(g.state === 'paused' ? t('factory.state.paused') : `${fmt.pct(g.productivity)} ${t(`factory.lines.band.${g.state}`)}`);
  for (const r of g.reasons) parts.push(`${t(`factory.reason.${r.reason}`)} ${r.count}`);
  if (bottleneck) parts.push(t('factory.lines.bottleneck.badge'));
  return parts.join(', ');
}

/** Reasons in `REASONS` order, as the factory page lists them. */
const sortedReasons = (g: LineGroup) => [...g.reasons].sort((a, b) => REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason));

/**
 * A machine group's content: the building's picture with its product pinned to it; "4× Constructor", the product, its
 * rate of the nominal one, then the productivity as bar and % in the band's colour, its reasons with counts and a
 * bottleneck badge.
 */
function GroupCard({ group: g, names, contentRef, bottleneck }: { group: LineGroup; names: Names; contentRef(el: HTMLElement | null): void; bottleneck: boolean }) {
  const { labels, fmt, t } = names;
  const out = mainOutput(g);
  const rate = groupRate(g, names);
  return (
    <span ref={contentRef} className="relative flex w-full min-w-0 items-start gap-2.5">
      <PinnedPicture cls={isClass(g.cls) ? labels.buildingPicture(g.cls) : ''} item={out} px={40} pin={18} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-[15px] leading-[18px] font-semibold tracking-wide break-words uppercase">{groupName(g, names)}</span>
        {out && <span className="text-sm leading-[18px] break-words">{labels.item(out, fmt.lang)}</span>}
        {rate && <span className="text-xs leading-4 text-muted tabular-nums">{rate}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <ProductivityBar value={g.productivity} band={g.band ?? bandOf(g.productivity)} paused={g.state === 'paused'} fmt={fmt} className="mr-1 text-sm" />
          {sortedReasons(g).map(r => <ReasonBadge key={r.reason} reason={r.reason} count={g.members.length > 1 ? r.count : undefined} />)}
          {bottleneck && <span className={badgeClass('accent')}>{t('factory.lines.bottleneck.badge')}</span>}
        </span>
      </span>
    </span>
  );
}

/** A logistics node (splitter, merger, storage, station): small and neutral, its picture and name. */
function LogisticsCard({ group: g, names, contentRef }: { group: LineGroup; names: Names; contentRef(el: HTMLElement | null): void }) {
  return (
    <span ref={contentRef} className="flex w-full min-w-0 items-center gap-2 text-muted">
      {isClass(g.cls) ? <Picture cls={names.labels.buildingPicture(g.cls)} px={20} /> : <Picture cls="" px={20} />}
      <span className="min-w-0 text-xs leading-4 break-words hyphens-auto">{groupName(g, names)}</span>
    </span>
  );
}

/**
 * On a phone the line's machine groups top down as a list (the diagram below stays scrollable, with the logistics in
 * between); a row opens its machines.
 */
function GroupList({ line, names, selected, onSelect, editorId, bottleneck }: {
  line: ProductionLine; names: Names; selected: string | null; onSelect(id: string): void; editorId: string; bottleneck?: string;
}) {
  const { t, labels, fmt } = names;
  const logistics = line.groups.filter(g => g.logistics).length;
  return (
    <>
      <ol aria-label={t('factory.lines.groupsLabel')} className="flex flex-col divide-y divide-line border-b border-line">
        {groupsTopDown(line).filter(g => !g.logistics).map(g => {
          const out = mainOutput(g);
          const open = selected === g.id;
          return (
            <li key={g.id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? editorId : undefined}
                onClick={() => onSelect(g.id)}
                className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-left focus-ring ${open ? 'bg-raised' : ''}`}
              >
                <PinnedPicture cls={isClass(g.cls) ? labels.buildingPicture(g.cls) : ''} item={out} px={24} pin={14} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{groupName(g, names)}{out ? ` · ${labels.item(out, fmt.lang)}` : ''}</span>
                  <span className="text-sm text-muted tabular-nums">{groupRate(g, names)}</span>
                </span>
                <ProductivityBar value={g.productivity} band={g.band ?? bandOf(g.productivity)} paused={g.state === 'paused'} fmt={fmt} />
                {bottleneck === g.id && <span className={badgeClass('accent')}>{t('factory.lines.bottleneck.badge')}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {logistics > 0 && <p className="border-b border-line px-3 py-2 text-sm text-muted">{t('factory.lines.logisticsInDiagram', { count: logistics })}</p>}
    </>
  );
}

/** What the special lines and marks of this diagram mean: always the line width, the rest only where it occurs. */
function Legend({ line, links, hasBottleneck, hidden, estimated, names }: {
  line: ProductionLine; links: readonly LineLink[]; hasBottleneck: boolean; hidden: number; estimated: boolean; names: Names;
}) {
  const { t } = names;
  const full = line.edges.some(isSaturated);
  const kinds = (['byproduct', 'loop'] as const).filter(k => links.some(l => l.kind === k));
  const states = [...new Set(line.groups.filter(g => !g.logistics).map(g => g.state))];
  const sample = (props: { width: number; className: string; dash?: string }) => (
    <svg aria-hidden="true" width="24" height="8" className="shrink-0">
      <line x1="0" y1="4" x2="24" y2="4" strokeWidth={props.width} strokeDasharray={props.dash} className={props.className} />
    </svg>
  );
  return (
    <ul aria-label={t('planner.diagram.legend.label')} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted max-[899px]:text-sm">
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="24" height="8" className="shrink-0">
          <line x1="0" y1="2" x2="24" y2="2" strokeWidth={1.25} className="stroke-edge" />
          <line x1="0" y1="6" x2="24" y2="6" strokeWidth={3} className="stroke-muted" />
        </svg>
        {t('factory.lines.legend.load')}
      </li>
      {full && <li className="flex items-center gap-1.5">{sample({ width: 3.5, className: 'stroke-accent' })}<span className="text-accent"><FullIcon /></span>{t('factory.lines.legend.full')}</li>}
      {kinds.map(k => (
        <li key={k} className="flex items-center gap-1.5">
          {sample({ width: 1.5, className: k === 'byproduct' ? 'stroke-free' : 'stroke-muted', dash: DASH[k] })}
          {t(`factory.lines.legend.${k}`)}
        </li>
      ))}
      {hasBottleneck && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-6 shrink-0 hazard" />{t('factory.lines.bottleneck.badge')}</li>}
      {states.map(s => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-3 w-1 shrink-0 border-l-4 ${STATE_EDGE[s]}`} />
          <span className={STATE_TEXT[s]}>{t(`factory.lines.band.${s}`)}</span>
        </li>
      ))}
      {hidden > 0 && <li>{t('factory.lines.legend.hidden', { count: hidden })}</li>}
      {estimated && <li>{t('factory.lines.legend.estimated')}</li>}
    </ul>
  );
}

/**
 * A selected group: what it makes and needs per minute, its productivity and reasons, all of it on the map, then each
 * member (machines with productivity, clock, reasons, loss, hints and "On the map"; logistics nodes by name).
 */
function GroupPanel({ worldId, group: g, analysis, names, onClose, recipeName }: {
  worldId: string; group: LineGroup; analysis: FactoryAnalysis; names: Names; onClose(): void; recipeName(id: string): string | undefined;
}) {
  const { t, labels, fmt } = names;
  const title = groupName(g, names);
  const out = mainOutput(g);
  const machines = g.members.map(id => analysis.byId.get(id)).filter(m => m !== undefined).sort((a, b) => a.productivity - b.productivity || a.id.localeCompare(b.id));
  const others = g.members.filter(id => !analysis.byId.has(id));
  const recipe = g.recipe ? recipeName(g.recipe) : undefined;
  const subtitle = [out && labels.item(out, fmt.lang), recipe && recipe !== (out && labels.item(out, fmt.lang)) ? recipe : undefined].filter(Boolean).join(' · ');
  const rates = (list: readonly LineRate[]) => list.map(r => `${labels.item(r.item, fmt.lang)} ${fmt.rate(r.perMin, fluidOf(r, labels))}`).join(', ');
  return (
    <Window
      as="div"
      level={3}
      title={title}
      icon={<PinnedPicture cls={isClass(g.cls) ? labels.buildingPicture(g.cls) : ''} item={out} px={24} pin={14} />}
      subtitle={subtitle || undefined}
      onClose={onClose}
      closeLabel={t('factory.lines.close', { name: title })}
      className="rounded-none border-0 shadow-none"
      bodyClassName="flex flex-col gap-3 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {!g.logistics && <ProductivityBar value={g.productivity} band={g.band ?? bandOf(g.productivity)} paused={g.state === 'paused'} fmt={fmt} />}
        {g.outputs.length > 0 && <span><span className="text-muted">{t('factory.lines.makes')}</span> {g.logistics ? rates(g.outputs) : groupRate(g, names)}{!g.logistics && g.outputs.length > 1 && <span className="text-muted"> + {rates(g.outputs.slice(1))}</span>}</span>}
        {g.inputs.length > 0 && <span><span className="text-muted">{t('factory.lines.needs')}</span> {rates(g.inputs)}</span>}
        <span className="flex flex-wrap gap-1">{sortedReasons(g).map(r => <ReasonBadge key={r.reason} reason={r.reason} count={r.count} />)}</span>
        <span className="ml-auto"><ShowOnMap worldId={worldId} ids={g.members} label={title} /></span>
      </div>
      {machines.length > 0 && (
        <ul aria-label={t('factory.lines.members')} className="flex flex-col divide-y divide-line">
          {machines.map(m => (
            <MachineLine
              key={m.id} worldId={worldId} m={m} item={out} labels={labels} fmt={fmt}
              lost={out && !m.paused ? lostOf(m, out) : null} fluid={out ? labels.isFluid(out) : false}
              recipeName={m.recipe ? recipeName(m.recipe) : undefined}
            />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul aria-label={t('factory.lines.members')} className="flex flex-col divide-y divide-line">
          {others.map((id, i) => {
            const name = isClass(g.cls) ? labels.building(g.cls, fmt.lang) : groupName(g, names);
            return (
              <li key={id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  {isClass(g.cls) && <Picture cls={labels.buildingPicture(g.cls)} px={20} />}
                  <span className="truncate">{others.length > 1 ? `${name} ${i + 1}` : name}</span>
                </span>
                <ShowOnMap worldId={worldId} ids={[id]} label={name} compact />
              </li>
            );
          })}
        </ul>
      )}
    </Window>
  );
}
