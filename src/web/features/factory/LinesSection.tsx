import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { bandOf, BANDS, lostOf, REASONS, type AnalysisData, type FactoryAnalysis } from '../../../shared/factory/analysis.js';
import { mergeHints, type LineGroup, type LineRate, type ProductionLine, type ProductionLines } from '../../../shared/factory/lines.js';
import { canAdmin } from '../../../shared/roles.js';
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
import { DirectionSwitch, useDiagramDirection } from '../planner/direction.js';
import type { DiagramDirection, DiagramEdge, DiagramOptions } from '../planner/diagramLayout.js';
import { FlowDiagram, type EdgeLook, type EdgeState, type FlowMarker } from '../planner/FlowDiagram.js';
import { Picture, PinnedPicture } from '../planner/pictures.js';
import type { FactoryLabels, SnapshotAnalysis } from './data.js';
import { stationNames, type FactoryFormat } from './format.js';
import { ExactIcon, FullIcon, NeckIcon } from './icons.js';
import { MachineLine } from './ItemsSection.js';
import {
  bottleneckOf, compactLine, flowsAt, groupsTopDown, IDLE_FLOW, isSaturated, isUnlinked, LINE_PARAM, lineEnds, lineGraph, lineTargets, lineTerminals, loadOf,
  MACHINES_ONLY_ABOVE, machinesOnly, mainOutput, NODE_WIDTH, throughGroups, withTerminals, type LineEnds, type LineLink, type LineLinkKind,
  type LineTerminal, type TerminalPlace,
} from './lineDiagram.js';
import { bottleneckText, capacityText, groupTitle, isClass, lineHasIssue, lineName, sortLines } from './lineInfo.js';
import { BottleneckChip, NONE, ProductivityBar, ReasonBadge, ShowOnMap, STATE_TEXT } from './parts.js';
import { useFactoryPage } from './timeline.js';
import { useProductionLines } from './useLines.js';
import { useFactoryView } from './view.js';

/** A phone (below Tailwind's `sm`): the diagram is not fitted to the width there, and the groups show as a list. */
const PHONE_QUERY = '(max-width: 639px)';
/** Lines listed before "Show all". */
const FIRST_LINES = 8;
/** Above this many machines a line's by-product links are folded (a switch shows them). */
const BYPRODUCTS_FOLD_ABOVE = 40;
/** The labels carry the rate and the capacity ("112.5/min of 120"), so they get more room than the planner's. */
const OPTIONS: Partial<DiagramOptions> = { nodeWidth: NODE_WIDTH, labelWidth: 196, portGap: 128 };
/** A node's padding and border around its content (`py-1.5`, 1 px borders). */
const CHROME = 12 + 2;

/** The productivity strip on the left of a machine group, in its state's colour (the % beside the bar says it too). */
const STATE_EDGE: Record<LineGroup['state'], string> = {
  idle: 'border-l-conflict', throttled: 'border-l-accent', high: 'border-l-power', full: 'border-l-free', paused: 'border-l-edge',
};

type View = 'diagram' | 'map';

/** Everything the parts of the section need to name things. */
interface Names {
  labels: FactoryLabels;
  fmt: FactoryFormat;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Station names by building id ("Lkw-Station 4", or the player's name). */
  stations: ReadonlyMap<string, string>;
}

/** Ends of a line drawn without its storage, stations and sinks as their own nodes (machines only). */
const NO_ENDS: LineEnds = { receivers: new Set(), sources: new Set() };
/** Items named in the summary above the diagram before "+n". */
const SUMMARY_ITEMS = 4;
/** Items an end's node lists before "+n". */
const END_ITEMS = 3;

/** "4× Constructor"; a single logistics node just by name ("Conveyor Merger"): `lineInfo.groupTitle`, as on the map. */
const groupName = (g: LineGroup, { labels, fmt, t }: Names): string => groupTitle(g, labels, fmt.lang, t);

const fluidOf = (r: LineRate, labels: FactoryLabels) => r.fluid ?? labels.isFluid(r.item);

/** "12.0/min of 15.0/min" for a group's main product, or just the actual rate without a nominal one. */
function groupRate(g: LineGroup, { labels, fmt, t }: Names): string | null {
  const out = g.outputs[0];
  if (!out) return null;
  const fluid = fluidOf(out, labels);
  const nominal = g.nominal.find(n => n.item === out.item);
  return nominal ? t('factory.lines.rateOf', { actual: fmt.rate(out.perMin, fluid), nominal: fmt.rate(nominal.perMin, fluid) }) : fmt.rate(out.perMin, fluid);
}

/** A line without products (it ends in generators or makes nothing yet): the picture of the building naming it. */
function linePicture(line: ProductionLine, labels: FactoryLabels): string {
  const g = line.groups.find(x => x.members.includes(line.id));
  return g && isClass(g.cls) ? labels.buildingPicture(g.cls) : '';
}

/** Where the selected line's diagram is opened from the map: the query parameter, else the page's own choice. */
function useLineChoice(lines: readonly ProductionLine[] | undefined) {
  // Lines come sorted (`sortLines`): without a choice the first one, the worst problem, opens.
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
  // One order for the page and the map: problems first, then by lost machine-equivalents (`sortLines`).
  const lines = useMemo(() => (result ? sortLines(result.lines) : undefined), [result]);
  const { line, choose, linked } = useLineChoice(lines);
  const phone = useMediaQuery(PHONE_QUERY);
  const [direction, setDirection] = useDiagramDirection('lines');
  const stations = useMemo(() => stationNames(shown.routes.stations, labels, fmt.lang), [shown.routes, labels, fmt.lang]);
  const names: Names = { labels, fmt, t, stations };
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
      <DirectionSwitch value={direction} onChange={setDirection} />
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
          worldId={ctx.worldId} line={line} analysis={shown.analysis} names={names} phone={phone} direction={direction} lines={result ?? null}
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

/** A save extracted before connections were read: import it again. The owner and admins get the import dialog. */
function NoLinks({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  return (
    <div className="flex flex-col items-start gap-2 p-3 text-sm">
      <p>{t('factory.lines.noLinks')}</p>
      {canAdmin(ctx.world.role)
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
                  <span className="font-medium break-words">{lineName(l, names.labels, names.fmt.lang)}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted max-[899px]:text-sm">
                    <span>{t('factory.machines.count', { count: l.machines.length })}</span>
                    <ProductivityBar value={l.productivity} band={band} fmt={fmt} className="text-xs" />
                    {lineHasIssue(l) && <BottleneckChip />}
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
  { key: 'full', className: 'fill-accent', size: 10 }, { key: 'neck', className: 'fill-conflict', size: 11 }, { key: 'byproduct', className: 'fill-free' },
];

/**
 * How full a connection reads: the line's bottleneck (`conflict`, an octagon "!"), full while what is before it backs up
 * (accent, a warning triangle), full and just enough (`exact`: busy, an equals sign, no warning), else by its load.
 * Colour and glyph tell them apart, not the width alone.
 */
type EdgeTone = 'neck' | 'full' | 'exact' | 'fg' | 'mid' | 'low';

/** Line style is the first cue, colour the second: by-products dotted, loops dashed, as in the planner. */
const DASH: Record<LineLinkKind, string | undefined> = { flow: undefined, byproduct: '1 5', loop: '6 4' };
/** A product no belt or pipe carries away: finer dashes than a loop, thin and grey. */
const UNLINKED_DASH = '2 3';

/**
 * One line: the bottleneck in a sentence, on a phone its groups as a list, the diagram, its legend and, for a selected
 * group, its machines.
 */
function LineView({ worldId, line: full, analysis, names, phone, direction, recipeName, lines }: {
  worldId: string; line: ProductionLine; analysis: FactoryAnalysis; names: Names; phone: boolean; direction: DiagramDirection;
  recipeName(id: string): string | undefined; lines: ProductionLines | null;
}) {
  const { t, labels, fmt } = names;
  const compact = useMemo(() => compactLine(full), [full]);
  const machinesChoice = useFactoryPage(s => s.machinesOnly);
  const setMachinesOnly = useFactoryPage(s => s.setMachinesOnly);
  const hasPassThrough = useMemo(() => throughGroups(compact.line).size > 0, [compact]);
  // Large lines open with their machines only, until the switch is used.
  const onlyMachines = hasPassThrough && (machinesChoice ?? compact.line.groups.length > MACHINES_ONLY_ABOVE);
  const machinesLine = useMemo(() => (onlyMachines ? machinesOnly(compact.line) : compact.line), [onlyMachines, compact]);
  // What leaves the line and what comes in as nodes of their own: with machines only in place of the storage,
  // stations and sinks at its ends; with all logistics those stay (drawn as outputs and inputs) and only what has no
  // belt or pipe gets a node.
  const { line, terminals } = useMemo(() => withTerminals(compact.line, machinesLine, onlyMachines), [compact, machinesLine, onlyMachines]);
  // With all logistics the storage, stations and sinks at the ends are drawn as outputs and inputs, those whose belts
  // carry next to nothing as the small logistics chips they are.
  const ends = useMemo((): LineEnds => {
    if (onlyMachines) return NO_ENDS;
    const all = lineEnds(line);
    const live = (id: string, side: 'in' | 'out') => flowsAt(line, id, side).some(r => r.perMin >= IDLE_FLOW);
    return { receivers: new Set([...all.receivers].filter(id => live(id, 'in'))), sources: new Set([...all.sources].filter(id => live(id, 'out'))) };
  }, [onlyMachines, line]);
  const outputs = useMemo(() => lineTerminals(compact.line), [compact]);
  const hidden = onlyMachines ? 0 : compact.hidden;
  // Storage and stations at an end that "Machines only" left out because their belts carry nothing.
  const idle = onlyMachines ? compact.line.groups.filter(g => g.logistics && !throughGroups(compact.line).has(g.id) && !machinesLine.groups.includes(g)).length : 0;
  // Large lines fold their dotted by-product links until asked.
  const big = full.machines.length > BYPRODUCTS_FOLD_ABOVE;
  const [showByproducts, setShowByproducts] = useState(false);
  const byproducts = !big || showByproducts;
  const graph = useMemo(() => lineGraph(line, { byproducts, terminals, ends }), [line, byproducts, terminals, ends]);
  const options = useMemo(() => ({ ...OPTIONS, direction }), [direction]);
  const folded = useMemo(
    () => (byproducts ? 0 : lineGraph(line, { terminals, ends }).links.length - graph.links.length),
    [line, byproducts, terminals, ends, graph],
  );
  const groupOf = useMemo(() => new Map(line.groups.map(g => [g.id, g])), [line]);
  const terminalOf = useMemo(() => new Map(terminals.map(x => [x.id, x])), [terminals]);
  const endOf = (id: string): 'out' | 'in' | null => (ends.receivers.has(id) ? 'out' : ends.sources.has(id) ? 'in' : null);
  /** What a storage, station or sink at an end receives (or gives), leaving out belts that carry next to nothing. */
  const endFlows = (id: string, side: 'in' | 'out') => flowsAt(line, id, side === 'out' ? 'in' : 'out').filter(r => r.perMin >= IDLE_FLOW);
  const [selected, setSelected] = useState<string | null>(null);
  const editorId = useId();
  const nodePrefix = useId();
  const nodeId = (id: string) => `${nodePrefix}${id}`;
  const bottleneck = bottleneckOf(line);
  // The bottleneck as the line names it, also where the diagram leaves its belt out.
  const sentence = bottleneckText(full, labels, fmt.lang, t);
  const issue = lineHasIssue(full);
  const name = lineName(full, labels, fmt.lang);
  // Wider than its box: the diagram opens at the bottleneck (its group, else the group its full belt leads to).
  const focus = bottleneck.group ?? bottleneck.edge?.to ?? null;
  const group = selected ? groupOf.get(selected) : undefined;
  const terminal = selected ? terminalOf.get(selected) : undefined;
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
  const toneOf = (e: DiagramEdge<LineLink>, state: EdgeState): EdgeTone => {
    const edge = edgeOf(e);
    if (bottleneck.edgeIndex === e.edge) return 'neck';
    if (isUnlinked(edge)) return state === 'hot' ? 'fg' : 'low';
    if (isSaturated(edge)) return edge.exact ? 'exact' : 'full';
    const load = loadOf(edge);
    return state === 'hot' ? 'fg' : load !== null && load < 0.5 ? 'low' : 'mid';
  };
  const edgeLook = (e: DiagramEdge<LineLink>, state: EdgeState): EdgeLook => {
    const edge = edgeOf(e);
    const tone = toneOf(e, state);
    const load = loadOf(edge);
    const width = (tone === 'neck' ? 4.5 : tone === 'full' || tone === 'exact' ? 3.5 : 1.25 + 2 * Math.min(1, load ?? 0.25)) + (state === 'hot' ? 1 : 0);
    // Made but carried by no belt or pipe: a thin, finely dashed line to its output.
    if (isUnlinked(edge)) {
      return { kind: 'unlinked', marker: tone === 'fg' ? 'fg' : 'low', className: tone === 'fg' ? 'stroke-fg' : 'stroke-edge', width: state === 'hot' ? 2.25 : 1.25, dash: UNLINKED_DASH, labelClassName: 'text-muted' };
    }
    if (e.kind === 'byproduct' && tone !== 'neck') {
      return { kind: e.kind, marker: 'byproduct', className: 'stroke-free', width, dash: DASH.byproduct, linecap: 'round', labelClassName: 'text-free' };
    }
    const stroke: Record<EdgeTone, string> = { neck: 'stroke-conflict', full: 'stroke-accent', exact: 'stroke-fg', fg: 'stroke-fg', low: 'stroke-edge', mid: 'stroke-muted' };
    const label: Record<EdgeTone, string> = { neck: 'text-conflict', full: 'text-accent', exact: 'text-fg', fg: 'text-fg', low: 'text-fg', mid: 'text-fg' };
    return {
      kind: tone === 'neck' ? 'bottleneck' : tone === 'full' || tone === 'exact' ? 'saturated' : e.kind,
      marker: tone === 'exact' ? 'fg' : tone, className: stroke[tone], width, dash: DASH[e.kind],
      labelClassName: e.kind === 'loop' && tone !== 'neck' && tone !== 'full' ? 'text-accent' : label[tone],
    };
  };
  const renderLabel = (e: DiagramEdge<LineLink>, state: EdgeState) => {
    const edge = edgeOf(e);
    const fluid = edge.pipe ?? (edge.item ? labels.isFluid(edge.item) : false);
    const tone = toneOf(e, state);
    const cap = capacityText(edge, labels, fmt.lang, t, true);
    const each = edge.perLink !== undefined && edge.links > 1;
    // Into a storage, station or sink at the end: the item by name too, so what leaves the line reads off the belt.
    const named = endOf(e.to) === 'out' && edge.item !== undefined && !(edge.items && edge.items.length > 1);
    return (
      <>
        {edge.items && edge.items.length > 1
          ? edge.items.slice(0, 3).map(r => <GameIcon key={r.item} cls={r.item} px={16} />)
          : edge.item && <GameIcon cls={edge.item} px={16} />}
        {named && <span data-label-item className="max-w-28 truncate font-normal">{labels.item(edge.item!, fmt.lang)}</span>}
        {edge.perMin !== undefined && <span>{fmt.rate(edge.perMin, fluid)}</span>}
        {cap && <span className="font-normal text-muted">{each ? ' · ' : ' '}{cap}</span>}
        {tone === 'neck' && <span className="text-conflict" data-neck><NeckIcon /></span>}
        {tone === 'full' && <span className="text-accent" data-full><FullIcon /></span>}
        {tone === 'exact' && <span className="inline-flex items-center gap-0.5 font-normal text-muted" data-exact><ExactIcon />{t('factory.lines.exact')}</span>}
      </>
    );
  };

  return (
    <div data-fullscreen-root="" className="flex min-w-0 flex-col">
      <LineSummary terminals={outputs} names={names} />
      {(sentence || hasPassThrough || big) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
          {sentence ? (
            <p data-bottleneck className="flex min-w-0 items-start gap-2 py-0.5 text-sm">
              {issue ? <><BottleneckChip className="mt-px" /><span className="sr-only">: </span></> : <span className="shrink-0 text-muted">{t('factory.lines.limit')}</span>}
              <span className={issue ? '' : 'text-muted'}>{sentence}</span>
            </p>
          ) : <span />}
          <span className="ml-auto flex flex-wrap gap-1">
            {big && (
              <Button size="sm" variant="ghost" aria-pressed={showByproducts} onClick={() => setShowByproducts(!showByproducts)}>
                <span aria-hidden="true" className={`inline-block size-3 border ${showByproducts ? 'border-accent bg-accent' : 'border-muted'}`} />
                {t('factory.lines.byproducts')}
              </Button>
            )}
            {hasPassThrough && (
              <Button size="sm" variant="ghost" aria-pressed={onlyMachines} onClick={() => setMachinesOnly(!onlyMachines)}>
                <span aria-hidden="true" className={`inline-block size-3 border ${onlyMachines ? 'border-accent bg-accent' : 'border-muted'}`} />
                {t('factory.lines.machinesOnly')}
              </Button>
            )}
          </span>
        </div>
      )}
      {phone && <GroupList line={line} names={names} selected={selected} onSelect={onSelect} editorId={editorId} bottleneck={bottleneck.group} issue={issue} />}
      <FlowDiagram<LineLink>
        nodes={graph.nodes}
        links={graph.links}
        options={options}
        label={t('factory.lines.diagram.label', { name })}
        hint={t(direction === 'right' ? 'factory.lines.diagram.hintRight' : 'factory.lines.diagram.hint')}
        selected={selected}
        onSelect={onSelect}
        onDismiss={close}
        editorId={editorId}
        nodeId={nodeId}
        focus={focus}
        moreLabel={t('factory.lines.moreRight')}
        nodeLabel={id => {
          const x = terminalOf.get(id);
          if (x) return terminalLabel(x, names);
          const end = endOf(id);
          if (end) return endLabel(groupOf.get(id)!, endFlows(id, end), end, names);
          return groupLabel(groupOf.get(id)!, names, bottleneck.group === id ? (issue ? 'issue' : 'limit') : null);
        }}
        nodeChrome={() => CHROME}
        nodeClassName={(id, isSelected) => {
          const side = terminalOf.get(id)?.side ?? endOf(id);
          // Outputs and inputs: framed in the accent (an input dashed, as the planner marks what comes from outside).
          if (side) return `px-2 py-1.5 ${side === 'out' ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-dashed border-accent'} ${isSelected ? 'bg-raised' : 'bg-panel hover:bg-raised'}`;
          const g = groupOf.get(id)!;
          // Logistics: a half-height chip on a rail through the row (the button itself stays as high as the row).
          if (g.logistics) return `items-center! justify-center border-transparent bg-transparent group/node ${isSelected ? 'text-accent' : ''}`;
          const frame = isSelected ? 'border-accent bg-raised' : 'border-edge bg-panel hover:border-muted hover:bg-raised';
          return `px-2 py-1.5 ${frame} border-l-4 ${STATE_EDGE[g.state]}`;
        }}
        renderNode={(id, contentRef) => {
          const x = terminalOf.get(id);
          if (x) return <TerminalCard terminal={x} names={names} contentRef={contentRef} />;
          const g = groupOf.get(id)!;
          const end = endOf(id);
          if (end) return <EndCard group={g} side={end} flows={endFlows(id, end)} names={names} contentRef={contentRef} />;
          return g.logistics
            ? <LogisticsCard group={g} names={names} contentRef={contentRef} selected={selected === id} across={direction === 'right'} />
            : <GroupCard group={g} names={names} contentRef={contentRef} neck={bottleneck.group === id ? (issue ? 'issue' : 'limit') : null} />;
        }}
        markers={MARKERS}
        edgeKey={e => `${e.edge}`}
        edgeLook={edgeLook}
        renderLabel={renderLabel}
        footer={(
          <Legend
            line={line} links={graph.links} neck={bottleneck.edgeIndex !== undefined} hidden={hidden} idle={idle} folded={folded} estimated={onlyMachines}
            ends={terminals.length > 0 || ends.receivers.size + ends.sources.size > 0} names={names}
          />
        )}
      />
      {(group || terminal) && (
        <div ref={panel} id={editorId} className="border-t border-line" onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
          {terminal
            ? <TerminalPanel worldId={worldId} terminal={terminal} groups={compact.line.groups} names={names} onClose={close} />
            : group && <GroupPanel worldId={worldId} group={group} analysis={analysis} names={names} onClose={close} recipeName={recipeName} lines={lines} />}
        </div>
      )}
    </div>
  );
}

/** A node's accessible name: "4× Constructor, Copper Sheet, 12.0/min of 15.0/min, 80 %, Part load, Shortage 2". */
/**
 * How a group is the line's bottleneck: a problem (`issue`, the "Engpass" chip) or only where it ends (`limit`, a
 * neutral "Grenze": what it makes is not taken off).
 */
type Neck = 'issue' | 'limit' | null;

/** A neutral mark for a group that only limits the line (no problem to fix). */
function LimitBadge() {
  const { t } = useTranslation();
  return <span className={badgeClass('neutral')}>{t('factory.lines.limitBadge')}</span>;
}

function groupLabel(g: LineGroup, names: Names, neck: Neck): string {
  const { t, labels, fmt } = names;
  const out = mainOutput(g);
  const parts = [groupName(g, names)];
  if (out) parts.push(labels.item(out, fmt.lang));
  const rate = groupRate(g, names);
  if (rate) parts.push(rate);
  if (!g.logistics) parts.push(g.state === 'paused' ? t('factory.state.paused') : `${fmt.pct(g.productivity)} ${t(`factory.lines.band.${g.state}`)}`);
  for (const r of g.reasons) parts.push(`${t(`factory.reason.${r.reason}`)} ${r.count}`);
  if (neck) parts.push(t(neck === 'issue' ? 'factory.lines.bottleneck.badge' : 'factory.lines.limitBadge'));
  return parts.join(', ');
}

/** Reasons in `REASONS` order, as the factory page lists them. */
const sortedReasons = (g: LineGroup) => [...g.reasons].sort((a, b) => REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason));

/**
 * A machine group's content: the building's picture with its product pinned to it; "4× Constructor", the product, its
 * rate of the nominal one, then the productivity as bar and % in the band's colour, its reasons with counts and a
 * bottleneck badge.
 */
function GroupCard({ group: g, names, contentRef, neck }: { group: LineGroup; names: Names; contentRef(el: HTMLElement | null): void; neck: Neck }) {
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
          {neck === 'issue' && <BottleneckChip />}
          {neck === 'limit' && <LimitBadge />}
        </span>
      </span>
    </span>
  );
}

/**
 * A logistics node (splitter, merger, storage, station): a small neutral chip with its picture and name, half the
 * height of a machine at most, on a thin rail through its row (the edges meet the row's top and bottom).
 */
function LogisticsCard({ group: g, names, contentRef, selected, across }: {
  group: LineGroup; names: Names; contentRef(el: HTMLElement | null): void; selected: boolean;
  /** Left to right: the rail runs across the column. */
  across: boolean;
}) {
  return (
    <>
      {across ? (
        <>
          <span aria-hidden="true" className="absolute inset-y-1 left-0 w-px bg-edge" />
          <span aria-hidden="true" className="absolute inset-y-1 right-0 w-px bg-edge" />
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-edge" />
        </>
      ) : (
        <>
          <span aria-hidden="true" className="absolute inset-x-6 top-0 h-px bg-edge" />
          <span aria-hidden="true" className="absolute inset-x-6 bottom-0 h-px bg-edge" />
          <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-edge" />
        </>
      )}
      <span
        ref={contentRef}
        className={`relative flex max-w-full min-w-0 items-center gap-1.5 chamfer border bg-bg px-1.5 py-0.5 text-muted group-hover/node:border-muted group-hover/node:bg-raised ${selected ? 'border-accent text-fg' : 'border-line'}`}
      >
        {isClass(g.cls) ? <Picture cls={names.labels.buildingPicture(g.cls)} px={16} /> : <Picture cls="" px={16} />}
        <span className="min-w-0 text-xs leading-4 break-words hyphens-auto">{groupName(g, names)}</span>
      </span>
    </>
  );
}

/** A storage, station or sink by name: a station by its own name ("Lkw-Station 4"), else the building's. */
function placeName(p: Pick<TerminalPlace, 'cls' | 'members'>, names: Names): string {
  const station = p.members.length === 1 ? names.stations.get(p.members[0]!) : undefined;
  if (station) return station;
  const name = isClass(p.cls) ? names.labels.building(p.cls, names.fmt.lang) : names.t(`factory.lines.kind.${p.cls}`, { defaultValue: p.cls });
  return p.members.length > 1 ? `${p.members.length}× ${name}` : name;
}

/**
 * Where an output goes or an input comes from, short: "Lagercontainer", "Lagercontainer, AWESOME-Schredder",
 * "2× Lagercontainer +1", "nicht angeschlossen" for the part no belt or pipe carries away.
 */
function placesText(x: LineTerminal, names: Names): string {
  const list = x.places.map(p => placeName(p, names));
  if (x.unlinked > 0) list.push(names.t('factory.lines.unlinked'));
  if (list.length === 0) return names.t('factory.lines.unlinked');
  return list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', ');
}

const rateOf = (r: Pick<LineRate, 'item' | 'perMin' | 'fluid'>, names: Names) => names.fmt.rate(r.perMin, r.fluid ?? names.labels.isFluid(r.item));

/** "Output: Wire, 124.0/min, to Storage Container, AWESOME Sink". */
function terminalLabel(x: LineTerminal, names: Names): string {
  const { t, labels, fmt } = names;
  const key = x.side === 'in' ? 'inputName' : x.places.length === 0 ? 'outputNameUnlinked' : 'outputName';
  return t(`factory.lines.${key}`, { item: labels.item(x.item, fmt.lang), rate: rateOf(x, names), place: placesText(x, names) });
}

/** "Output: Storage Container, receives Iron Plate 20.0/min": a storage, station or sink at an end. */
function endLabel(g: LineGroup, flows: readonly LineRate[], side: 'in' | 'out', names: Names): string {
  const { t, labels, fmt } = names;
  const items = flows.length > 0 ? flows.map(r => `${labels.item(r.item, fmt.lang)} ${rateOf(r, names)}`).join(', ') : NONE;
  return t(side === 'out' ? 'factory.lines.endOut' : 'factory.lines.endIn', { name: placeName(g, names), items });
}

/** "AUSGANG" / "EINGANG" over an output's or input's node. */
function SideMark({ side }: { side: 'in' | 'out' }) {
  const { t } = useTranslation();
  return (
    <span className={`font-display text-[11px] leading-4 font-semibold tracking-wider uppercase ${side === 'out' ? 'text-accent' : 'text-muted'}`}>
      {t(side === 'out' ? 'factory.lines.output' : 'factory.lines.input')}
    </span>
  );
}

/**
 * An output or input node: "AUSGANG", the item's picture and name, its rate, and where it goes ("→ Lagercontainer",
 * "→ nicht angeschlossen") or comes from ("← Lkw-Station 4").
 */
function TerminalCard({ terminal: x, names, contentRef }: { terminal: LineTerminal; names: Names; contentRef(el: HTMLElement | null): void }) {
  const { labels, fmt } = names;
  return (
    <span ref={contentRef} data-terminal={x.side} className="flex w-full min-w-0 flex-col">
      <SideMark side={x.side} />
      <span className="flex min-w-0 items-start gap-2">
        <Picture cls={x.item} px={24} dashed={x.side === 'in'} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm leading-[18px] font-medium break-words">{labels.item(x.item, fmt.lang)}</span>
          <span className="text-xs leading-4 tabular-nums">{rateOf(x, names)}</span>
          <span className="text-xs leading-4 break-words text-muted">{x.side === 'out' ? '→ ' : '← '}{placesText(x, names)}</span>
        </span>
      </span>
    </span>
  );
}

/**
 * A storage, station or sink at an end of the line, drawn with all logistics: framed as an output (or input), its
 * picture and name, and what it receives (or gives) item by item with the rate.
 */
function EndCard({ group: g, side, flows, names, contentRef }: {
  group: LineGroup; side: 'in' | 'out'; flows: readonly LineRate[]; names: Names; contentRef(el: HTMLElement | null): void;
}) {
  const { labels, fmt, t } = names;
  return (
    <span ref={contentRef} data-end={side} className="flex w-full min-w-0 flex-col">
      <SideMark side={side} />
      <span className="flex min-w-0 items-start gap-2">
        {isClass(g.cls) ? <Picture cls={labels.buildingPicture(g.cls)} px={24} /> : <Picture cls="" px={24} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm leading-[18px] font-medium break-words">{placeName(g, names)}</span>
          {flows.length === 0 && <span className="text-xs leading-4 text-muted">{t(side === 'out' ? 'factory.lines.receivesNothing' : 'factory.lines.givesNothing')}</span>}
          {flows.slice(0, END_ITEMS).map(r => (
            <span key={r.item} className="flex min-w-0 items-center gap-1 text-xs leading-4">
              <GameIcon cls={r.item} px={14} />
              <span className="min-w-0 truncate">{labels.item(r.item, fmt.lang)}</span>
              <span className="ml-auto shrink-0 tabular-nums">{rateOf(r, names)}</span>
            </span>
          ))}
          {flows.length > END_ITEMS && <span className="text-xs leading-4 text-muted">+{flows.length - END_ITEMS}</span>}
        </span>
      </span>
    </span>
  );
}

/**
 * What the line makes, where it goes and what it gets, above the diagram (also in full screen and zoomed in):
 * "Erzeugt: Draht 124,0/min, Beton 79,9/min · Ziel: 3× Lagercontainer, 2× AWESOME-Schredder · Bezieht: Kabel 4,8/min".
 */
function LineSummary({ terminals, names }: { terminals: readonly LineTerminal[]; names: Names }) {
  const { t, labels, fmt } = names;
  const outs = terminals.filter(x => x.side === 'out');
  const ins = terminals.filter(x => x.side === 'in');
  if (outs.length === 0 && ins.length === 0) return null;
  const targets = lineTargets(terminals);
  const items = (list: readonly LineTerminal[]) => (
    <>
      {list.slice(0, SUMMARY_ITEMS).map((x, i) => (
        <span key={x.id} className="inline-flex items-center gap-1 whitespace-nowrap">
          <GameIcon cls={x.item} px={16} />
          <span>{labels.item(x.item, fmt.lang)} <span className="tabular-nums">{rateOf(x, names)}</span>{i < Math.min(list.length, SUMMARY_ITEMS) - 1 ? ',' : ''}</span>
        </span>
      ))}
      {list.length > SUMMARY_ITEMS && <span className="text-muted">+{list.length - SUMMARY_ITEMS}</span>}
    </>
  );
  const where = [
    ...targets.places.map(p => {
      const name = (p.group && names.stations.get(p.group)) ?? (isClass(p.cls) ? labels.building(p.cls, fmt.lang) : p.cls);
      return p.count > 1 ? `${p.count}× ${name}` : name;
    }),
    ...(targets.unlinked ? [t('factory.lines.unlinked')] : []),
  ];
  return (
    <p data-line-summary className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-sm">
      {outs.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-muted">{t('factory.lines.summary.makes')}</span>
          {items(outs)}
        </span>
      )}
      {where.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span aria-hidden="true" className="text-muted">·</span>
          <span className="text-muted">{t('factory.lines.summary.to')}</span>
          <span>{where.join(', ')}</span>
        </span>
      )}
      {ins.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {outs.length > 0 && <span aria-hidden="true" className="text-muted">·</span>}
          <span className="text-muted">{t('factory.lines.summary.gets')}</span>
          {items(ins)}
        </span>
      )}
    </p>
  );
}

/**
 * A selected output or input: the item with its rate, then each storage, station or sink taking or giving it with
 * its rate and "On the map", and for the part no belt or pipe carries away the machines making it.
 */
function TerminalPanel({ worldId, terminal: x, groups, names, onClose }: {
  worldId: string; terminal: LineTerminal; groups: readonly LineGroup[]; names: Names; onClose(): void;
}) {
  const { t, labels, fmt } = names;
  const item = labels.item(x.item, fmt.lang);
  const title = t(x.side === 'out' ? 'factory.lines.outputTitle' : 'factory.lines.inputTitle', { item });
  const makers = x.unlinked > 0 ? groups.filter(g => x.makers.includes(g.id)) : [];
  const all = [...x.places.flatMap(p => p.members), ...makers.flatMap(g => g.members)];
  return (
    <Window
      as="div"
      level={3}
      title={title}
      icon={<Picture cls={x.item} px={24} dashed={x.side === 'in'} />}
      subtitle={rateOf(x, names)}
      onClose={onClose}
      closeLabel={t('factory.lines.close', { name: title })}
      className="rounded-none border-0 shadow-none"
      bodyClassName="flex flex-col gap-2 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted">{t(x.side === 'out' ? 'factory.lines.terminalOut' : 'factory.lines.terminalIn')}</span>
        <span className="ml-auto"><ShowOnMap worldId={worldId} ids={all} label={title} /></span>
      </div>
      {x.places.length > 0 && (
        <ul aria-label={t(x.side === 'out' ? 'factory.lines.receivers' : 'factory.lines.suppliers')} className="flex flex-col divide-y divide-line">
          {x.places.map(p => {
            const name = placeName(p, names);
            return (
              <li key={p.group} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  {isClass(p.cls) && <Picture cls={labels.buildingPicture(p.cls)} px={20} />}
                  <span className="truncate">{name}</span>
                </span>
                <span className="ml-auto shrink-0 text-sm tabular-nums">{rateOf({ ...x, perMin: p.perMin }, names)}</span>
                <ShowOnMap worldId={worldId} ids={p.members} label={name} compact />
              </li>
            );
          })}
        </ul>
      )}
      {x.unlinked > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            <span className="font-medium">{t('factory.lines.unlinked')}</span>{' '}
            <span className="tabular-nums">{rateOf({ ...x, perMin: x.unlinked }, names)}</span>
            <span className="text-muted"> – {t('factory.lines.unlinkedHint')}</span>
          </p>
          {makers.length > 0 && (
            <ul aria-label={t('factory.lines.unlinkedMakers')} className="flex flex-col divide-y divide-line">
              {makers.map(g => {
                const name = groupName(g, names);
                return (
                  <li key={g.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <PinnedPicture cls={isClass(g.cls) ? labels.buildingPicture(g.cls) : ''} item={x.item} px={20} pin={12} />
                      <span className="truncate">{name}</span>
                    </span>
                    <ShowOnMap worldId={worldId} ids={g.members} label={name} compact />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Window>
  );
}

/**
 * On a phone the line's machine groups top down as a list (the diagram below stays scrollable, with the logistics in
 * between); a row opens its machines.
 */
function GroupList({ line, names, selected, onSelect, editorId, bottleneck, issue }: {
  line: ProductionLine; names: Names; selected: string | null; onSelect(id: string): void; editorId: string; bottleneck?: string; issue: boolean;
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
                {bottleneck === g.id && (issue ? <BottleneckChip /> : <LimitBadge />)}
              </button>
            </li>
          );
        })}
      </ol>
      {logistics > 0 && <p className="border-b border-line px-3 py-2 text-sm text-muted">{t('factory.lines.logisticsInDiagram', { count: logistics })}</p>}
    </>
  );
}

/**
 * What the lines and marks of this diagram mean: the width (load) always, the full, just-enough and bottleneck belts
 * where they occur, by-products and loops where drawn, and every productivity band (so "Fast voll" can be read off a
 * node's strip even when none has it).
 */
function Legend({ line, links, neck, hidden, idle, folded, estimated, ends, names }: {
  line: ProductionLine; links: readonly LineLink[]; neck: boolean; hidden: number; idle: number; folded: number; estimated: boolean;
  /** Output or input nodes are drawn. */
  ends: boolean;
  names: Names;
}) {
  const { t } = names;
  const unlinked = links.some(l => isUnlinked(line.edges[l.edge]!));
  const full = line.edges.some(e => isSaturated(e) && !e.exact);
  const exact = line.edges.some(e => isSaturated(e) && e.exact);
  const kinds = (['byproduct', 'loop'] as const).filter(k => links.some(l => l.kind === k));
  const paused = line.groups.some(g => !g.logistics && g.state === 'paused');
  const states = [...BANDS, ...(paused ? ['paused' as const] : [])];
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
      {exact && <li className="flex items-center gap-1.5">{sample({ width: 3.5, className: 'stroke-fg' })}<ExactIcon />{t('factory.lines.legend.exact')}</li>}
      {neck && <li className="flex items-center gap-1.5">{sample({ width: 4.5, className: 'stroke-conflict' })}<span className="text-conflict"><NeckIcon /></span>{t('factory.lines.legend.neck')}</li>}
      {ends && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-5 shrink-0 border-2 border-accent" />
          {t('factory.lines.legend.ends')}
        </li>
      )}
      {unlinked && <li className="flex items-center gap-1.5">{sample({ width: 1.25, className: 'stroke-edge', dash: UNLINKED_DASH })}{t('factory.lines.legend.unlinked')}</li>}
      {kinds.map(k => (
        <li key={k} className="flex items-center gap-1.5">
          {sample({ width: 1.5, className: k === 'byproduct' ? 'stroke-free' : 'stroke-muted', dash: DASH[k] })}
          {t(`factory.lines.legend.${k}`)}
        </li>
      ))}
      {states.map(s => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-3 w-1 shrink-0 border-l-4 ${STATE_EDGE[s]}`} />
          <span className={STATE_TEXT[s]}>{t(`factory.lines.band.${s}`)}</span>
        </li>
      ))}
      {hidden > 0 && <li>{t('factory.lines.legend.hidden', { count: hidden })}</li>}
      {idle > 0 && <li>{t('factory.lines.legend.idle', { count: idle })}</li>}
      {folded > 0 && <li>{t('factory.lines.legend.folded', { count: folded })}</li>}
      {estimated && <li>{t('factory.lines.legend.estimated')}</li>}
    </ul>
  );
}

/**
 * A selected group: what it makes and needs per minute, its productivity and reasons, all of it on the map, then each
 * member (machines with productivity, clock, reasons, loss, hints and "On the map"; logistics nodes by name).
 */
function GroupPanel({ worldId, group: g, analysis, names, onClose, recipeName, lines }: {
  worldId: string; group: LineGroup; analysis: FactoryAnalysis; names: Names; onClose(): void; recipeName(id: string): string | undefined; lines: ProductionLines | null;
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
        {g.outputs.length > 0 && <span><span className="text-muted">{t(g.logistics ? 'factory.lines.gives' : 'factory.lines.makes')}</span> {g.logistics ? rates(g.outputs) : groupRate(g, names)}{!g.logistics && g.outputs.length > 1 && <span className="text-muted"> + {rates(g.outputs.slice(1))}</span>}</span>}
        {g.inputs.length > 0 && <span><span className="text-muted">{t(g.logistics ? 'factory.lines.receives' : 'factory.lines.needs')}</span> {rates(g.inputs)}</span>}
        <span className="flex flex-wrap gap-1">{sortedReasons(g).map(r => <ReasonBadge key={r.reason} reason={r.reason} count={r.count} />)}</span>
        <span className="ml-auto"><ShowOnMap worldId={worldId} ids={g.members} label={title} /></span>
      </div>
      {machines.length > 0 && (
        <ul aria-label={t('factory.lines.members')} className="flex flex-col divide-y divide-line">
          {machines.map(m => (
            <MachineLine
              key={m.id} worldId={worldId} m={m} item={out} labels={labels} fmt={fmt}
              lost={out && !m.paused ? lostOf(m, out) : null} fluid={out ? labels.isFluid(out) : false}
              recipeName={m.recipe ? recipeName(m.recipe) : undefined} hints={mergeHints(m, lines)}
            />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul aria-label={t('factory.lines.members')} className="flex flex-col divide-y divide-line">
          {others.map((id, i) => {
            const station = names.stations.get(id);
            const name = station ?? (isClass(g.cls) ? labels.building(g.cls, fmt.lang) : groupName(g, names));
            return (
              <li key={id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  {isClass(g.cls) && <Picture cls={labels.buildingPicture(g.cls)} px={20} />}
                  <span className="truncate">{others.length > 1 && !station ? `${name} ${i + 1}` : name}</span>
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
