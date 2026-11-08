import { Fragment, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  itemCause, lostOf, REASONS, type CauseContext, type FactoryAnalysis, type ItemCause, type ItemFlow, type ItemStatus, type MachineFlow, type MachineHint,
} from '../../../shared/factory/analysis.js';
import { causeContext, mergeHints, type LineHint, type ProductionLines } from '../../../shared/factory/lines.js';
import { badgeClass } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { ChevronDownIcon } from '../../components/icons.js';
import { Window } from '../../components/Window.js';
import { Picture } from '../planner/pictures.js';
import { PurityDot } from '../resourceNodes/PurityPips.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { Cell, LocateContext, LossBar, ProductivityBar, ReasonBadge, ShowOnMap, TABLE, TD, TD_FIRST, TH, THEAD, TR } from './parts.js';
import { useFactoryPage } from './timeline.js';

/** Losses below this (per minute) round to 0.0 and are not listed. */
export const MIN_LOSS = 0.05;
/** Rows shown per group before "Show all": the start of the list. */
const FIRST_ROWS = 5;
/** Where the jam ends: at most this many end points are listed. */
const MAX_ENDS = 4;

/** The three groups of the list, in its order (see `compareItems`). */
type Group = 'shortage' | 'rest' | 'surplus';
const GROUPS: readonly Group[] = ['shortage', 'rest', 'surplus'];
const groupOf = (s: ItemStatus): Group => (s === 'shortage' ? 'shortage' : s === 'surplus' ? 'surplus' : 'rest');

/**
 * The machine-equivalents an item loses: Σ (1 − productivity) of the machines making it as their main product (paused
 * ones left out), the same measure the production lines are ordered by.
 */
export function itemLoss(it: Pick<ItemFlow, 'item' | 'machines'>): number {
  return it.machines.reduce((s, m) => s + (!m.paused && m.outputs[0]?.item === it.item ? 1 - m.productivity : 0), 0);
}

/** Within each group the items losing the most machine-equivalents first, then by share lost (`compareItems`). */
export function rankItems(items: readonly ItemFlow[]): Map<Group, ItemFlow[]> {
  const out = new Map<Group, ItemFlow[]>(GROUPS.map(g => [g, []]));
  for (const it of items) out.get(groupOf(it.status))!.push(it);
  const loss = new Map(items.map(it => [it.item, itemLoss(it)]));
  for (const list of out.values()) list.sort((a, b) => loss.get(b.item)! - loss.get(a.item)! || b.share - a.share || b.lost - a.lost || a.item.localeCompare(b.item));
  return out;
}

/**
 * "Inefficient items": every item a machine makes below its nominal rate. Shortages first (makers starve: fix these
 * first), then the rest by the share of output lost, surplus (extractors that make more than is taken off) last; the
 * absolute loss is shown with a bar scaled per unit (pieces and m³ never share a scale). Items no machine in the
 * factory uses are marked "no consumer". A row unfolds into the cause across the chain (its consumers and their state,
 * where a jam ends, a transport limit) and the machines making it.
 */
export function ItemsSection({ worldId, analysis, lines = null, labels, fmt }: {
  worldId: string; analysis: FactoryAnalysis; lines?: ProductionLines | null; labels: FactoryLabels; fmt: FactoryFormat;
}) {
  const { t } = useTranslation();
  const expanded = useFactoryPage(s => s.expanded);
  const toggle = useFactoryPage(s => s.toggleItem);
  const [open, setOpen] = useState<ReadonlySet<Group>>(new Set());
  const losing = analysis.items.filter(i => i.lost >= MIN_LOSS);
  const full = analysis.items.length - losing.length;
  const shortage = losing.filter(i => i.status === 'shortage').length;
  const ranked = useMemo(() => rankItems(losing), [losing]);
  const ctx = useMemo<CauseContext>(() => (lines ? causeContext(lines, analysis) : {}), [lines, analysis]);
  // The top of each group first ("start here"); the rest of a group behind its own "Show all".
  const rows = GROUPS.flatMap(g => {
    const list = ranked.get(g)!;
    const visible = open.has(g) ? list : list.slice(0, FIRST_ROWS);
    return visible.map((it, i) => ({ it, group: g, first: i === 0, last: i === visible.length - 1, rest: list.length - visible.length, total: list.length }));
  });
  const toggleGroup = (g: Group) => setOpen(prev => { const next = new Set(prev); if (next.has(g)) next.delete(g); else next.add(g); return next; });
  const maxLoss = useMemo(() => {
    const max = { solid: 0, fluid: 0 };
    for (const i of losing) {
      const k = labels.isFluid(i.item) ? 'fluid' : 'solid';
      max[k] = Math.max(max[k], i.lost);
    }
    return max;
  }, [losing, labels]);
  const lang = fmt.lang;
  const cols = [t('factory.items.nominal'), t('factory.items.actual'), t('factory.items.lost'), t('factory.items.machines'), t('factory.items.reason')];

  return (
    <Window
      title={t('factory.items.title')}
      subtitle={t('factory.items.subtitle', { losing: losing.length, full, shortage })}
      bodyClassName="p-0"
    >
      {losing.length === 0 ? (
        <p className="p-3 text-sm text-muted">{t('factory.items.none')}</p>
      ) : (
        <table role="table" className={TABLE}>
          <thead role="rowgroup" className={THEAD}>
            <tr role="row">
              <th role="columnheader" scope="col" className={TH}>{t('factory.items.item')}</th>
              {cols.map((c, i) => <th key={c} role="columnheader" scope="col" className={`${TH} ${i < 4 ? 'text-right' : ''}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {rows.map(({ it, group, first, last, rest, total }) => {
              const unfolded = expanded.includes(it.item);
              const name = labels.item(it.item, lang);
              const fluid = labels.isFluid(it.item);
              const rowsId = `factory-item-${it.item}`;
              const newGroup = first;
              const noConsumer = it.consumers === 0 && it.loadedAt === 0;
              const surplus = group === 'surplus';
              return (
                <Fragment key={it.item}>
                  {newGroup && (
                    <tr role="row" className="border-t border-line bg-bg/40 max-sm:block">
                      <Cell className="px-2 pt-2.5 pb-1 font-display text-xs font-semibold tracking-wider text-muted uppercase max-sm:block max-sm:px-3" colSpan={6}>
                        {t(`factory.items.group.${group}`)}
                      </Cell>
                    </tr>
                  )}
                  <tr role="row" className={`${TR} ${unfolded ? 'bg-raised' : ''}`}>
                    <Cell className={TD_FIRST}>
                      <button
                        type="button"
                        aria-expanded={unfolded}
                        aria-controls={rowsId}
                        onClick={() => toggle(it.item)}
                        className="flex min-h-9 w-full items-center gap-2 text-left focus-ring max-[899px]:min-h-11"
                      >
                        <ChevronDownIcon size={14} className={`text-muted motion-safe:transition-transform ${unfolded ? '' : '-rotate-90'}`} />
                        <Picture cls={it.item} px={24} />
                        <span className="min-w-0 font-medium">{name}</span>
                        {noConsumer && <span className={badgeClass('neutral')} title={t('factory.items.noConsumerHint')}>{t('factory.items.noConsumer')}</span>}
                      </button>
                    </Cell>
                    <Cell label={cols[0]} className={`${TD} text-right`}>{fmt.rate(it.nominal, fluid)}</Cell>
                    <Cell label={cols[1]} className={`${TD} text-right`}>
                      {fmt.rate(it.actual, fluid)}
                      <span className="ml-1 text-xs text-muted">({fmt.pct(it.nominal > 0 ? it.actual / it.nominal : 1)})</span>
                    </Cell>
                    <Cell label={cols[2]} className={`${TD} text-right max-sm:col-span-2`}>
                      {/* Surplus is no real loss (more is mined than taken off): its bar in grey, not red. */}
                      <LossBar share={it.lost / Math.max(1e-9, fluid ? maxLoss.fluid : maxLoss.solid)} label={fmt.rate(it.lost, fluid)} muted={surplus} />
                    </Cell>
                    <Cell label={cols[3]} className={`${TD} text-right`}>{fmt.int(it.machines.length)}</Cell>
                    <Cell label={cols[4]} className={TD}>{it.mainReason && <ReasonBadge reason={it.mainReason} />}</Cell>
                  </tr>
                  {unfolded && (
                    <tr role="row" id={rowsId} className="bg-bg/60 max-sm:block">
                      <Cell colSpan={6} className="px-2 pt-1 pb-3 max-sm:block max-sm:px-3">
                        <ItemDetail worldId={worldId} analysis={analysis} item={it} lines={lines} ctx={ctx} labels={labels} fmt={fmt} />
                      </Cell>
                    </tr>
                  )}
                  {last && (rest > 0 || open.has(group)) && total > FIRST_ROWS && (
                    <tr role="row" className="border-t border-line max-sm:block">
                      <Cell colSpan={6} className="px-2 py-1 max-sm:block">
                        <Button size="sm" variant="ghost" onClick={() => toggleGroup(group)} aria-expanded={open.has(group)}>
                          {open.has(group) ? t('factory.showFewer') : t('factory.items.moreInGroup', { count: rest })}
                        </Button>
                      </Cell>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Window>
  );
}

/** An unfolded item: the cause across the chain (read with the production lines), then the machines making it. */
function ItemDetail({ worldId, analysis, item, lines, ctx, labels, fmt }: {
  worldId: string; analysis: FactoryAnalysis; item: ItemFlow; lines: ProductionLines | null; ctx: CauseContext; labels: FactoryLabels; fmt: FactoryFormat;
}) {
  const cause = useMemo(() => itemCause(analysis, item.item, ctx), [analysis, item.item, ctx]);
  // A full shared belt in front of its extractors (`sharedBeltFull`): the one note that explains their surplus.
  const shared = item.machines.map(m => mergeHints(m, lines).find(h => h.kind === 'sharedBeltFull')).find(h => h !== undefined);
  return (
    <div className="flex flex-col gap-3">
      <CauseView worldId={worldId} cause={cause} item={item} labels={labels} fmt={fmt} shared={shared} />
      <ItemMachines worldId={worldId} item={item} lines={lines} labels={labels} fmt={fmt} />
    </div>
  );
}

/**
 * The cause across the chain: who uses the item and how they run ("Copper Sheet 11 (8 backed up, 3 full)"), whether
 * the transport in between is the limit, and where a jam ends ("The jam ends at: Wire → Cable · no consumer").
 */
function CauseView({ worldId, cause, item, labels, fmt, shared }: {
  worldId: string; cause: ItemCause; item: ItemFlow; labels: FactoryLabels; fmt: FactoryFormat; shared?: MachineHint | LineHint;
}) {
  const { t } = useTranslation();
  const lang = fmt.lang;
  const name = labels.item(item.item, lang);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {cause.transportLimited && (
        <p className="border-l-2 border-accent pl-2 text-fg">{t('factory.items.transport')}</p>
      )}
      {shared && <p className="border-l-2 border-accent pl-2 text-fg">{hintText(shared, labels, fmt, t)}</p>}
      <div className="flex flex-col gap-1">
        <h4 className="font-display text-xs font-semibold tracking-wider text-muted uppercase">{t('factory.items.consumers')}</h4>
        {cause.consumers.length === 0 ? (
          <p className="text-muted">
            {t('factory.items.consumersNone', { item: name })}
            {item.loadedAt > 0 && <> {t('factory.items.loadedAt', { count: item.loadedAt })}</>}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {cause.consumers.map(g => {
              const gname = g.product ? labels.item(g.product, lang) : labels.building(g.cls, lang);
              const states = [
                ...REASONS.filter(r => g.reasons[r]).map(r => t('factory.items.reasonCount', { count: g.reasons[r], reason: t(`factory.reason.${r}`) })),
                ...(g.fine > 0 ? [t('factory.items.fine', { count: g.fine })] : []),
              ];
              return (
                <li key={g.key} className="inline-flex items-center gap-1.5 chamfer border border-line bg-bg py-0.5 pr-0.5 pl-1.5">
                  <Picture cls={g.product ?? labels.buildingPicture(g.cls)} px={16} />
                  <span>
                    {t('factory.items.consumerGroup', { name: gname, count: g.ids.length })}
                    {states.length > 0 && <span className="text-muted"> ({states.join(', ')})</span>}
                  </span>
                  <ShowOnMap worldId={worldId} ids={g.ids} label={gname} compact />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {cause.why && <p className="text-muted">{t(`factory.items.endsHere.${cause.why}`)}</p>}
      {cause.jamEnds.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="font-display text-xs font-semibold tracking-wider text-muted uppercase">{t('factory.items.jamEnds')}</h4>
          <ul className="flex flex-col gap-0.5">
            {cause.jamEnds.slice(0, MAX_ENDS).map(end => (
              <li key={end.item} className="flex flex-wrap items-center gap-x-1.5">
                {end.path.slice(1).map((p, i, list) => (
                  <Fragment key={p}>
                    {i > 0 && <span aria-hidden="true" className="text-muted">→</span>}
                    <span className={i === list.length - 1 ? 'font-semibold' : 'text-muted'}>{labels.item(p, lang)}</span>
                  </Fragment>
                ))}
                <span className="text-muted">· {t(`factory.items.why.${end.why}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The machines making one item, most loss first, each with "Show on map"; and all of them on the map at once. */
function ItemMachines({ worldId, item, lines, labels, fmt }: { worldId: string; item: ItemFlow; lines: ProductionLines | null; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const fluid = labels.isFluid(item.item);
  const losing = item.machines.filter(m => !m.paused && lostOf(m, item.item) >= MIN_LOSS);
  const name = labels.item(item.item, fmt.lang);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-xs font-semibold tracking-wider text-muted uppercase">
          {t('factory.items.makers')} <span className="normal-case tracking-normal">· {t('factory.items.machineSummary', { losing: losing.length, total: item.machines.length })}</span>
        </h4>
        <ShowOnMap worldId={worldId} ids={(losing.length > 0 ? losing : item.machines).map(m => m.id)} label={name} />
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {item.machines.map(m => (
          <MachineLine key={m.id} worldId={worldId} m={m} item={item.item} lost={lostOf(m, item.item)} fluid={fluid} labels={labels} fmt={fmt} hints={mergeHints(m, lines)} />
        ))}
      </ul>
    </div>
  );
}

/** A hint's tone: a limit to fix in the accent, a guess or "just enough" muted (no warning), shards in their colour. */
const HINT_TONE: Record<(MachineHint | LineHint)['kind'], string> = {
  beltLimits: 'text-accent', noBelt: 'text-accent', beltBehind: 'text-muted', overclockUseless: 'text-shard', sharedBeltFull: 'text-accent', beltExact: 'text-muted',
};

/** A hint about a machine's output, in words ("Conveyor Belt Mk.1 limits it to 60.0/min"); pipes in m³. */
export function hintText(h: MachineHint | LineHint, labels: FactoryLabels, fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string): string {
  const belt = (cls: string, rate: number) => ({ belt: labels.building(cls, fmt.lang), rate: fmt.rate(rate, /Pipeline/.test(cls)) });
  switch (h.kind) {
    case 'beltLimits': return t('factory.machine.hint.beltLimits', belt(h.belt, h.rate));
    case 'beltBehind': return t('factory.machine.hint.beltBehind', belt(h.belt, h.rate));
    case 'noBelt': return t('factory.machine.hint.noBelt');
    case 'overclockUseless': return t('factory.machine.hint.overclockUseless', { shards: h.shards });
    case 'sharedBeltFull': return t('factory.machine.hint.sharedBeltFull', belt(h.belt, h.rate));
    case 'beltExact': return t('factory.machine.hint.beltExact', belt(h.belt, h.rate));
  }
}

/**
 * One machine in a list: picture, name, what it makes and where (the biome nearby), productivity, clock speed with its
 * Power Shards, reasons, its loss and "Show on map". A row of columns from 640 px; on a phone name and map button,
 * then productivity, clock and loss, then the reasons. Extractors (and machines with a hint) get a line with what they
 * make of what they should, the node's purity, the belt at their output and the hints.
 */
export function MachineLine({ worldId, m, lost, fluid, labels, fmt, recipeName, item, hints = m.hints }: {
  worldId: string; m: MachineFlow; lost: number | null; fluid: boolean; labels: FactoryLabels; fmt: FactoryFormat; recipeName?: string;
  /** The item the list is about (its output is shown); else the main output. */
  item?: string;
  /** Its hints with the production line's (`mergeHints`); the analysis's alone by default. */
  hints?: readonly (MachineHint | LineHint)[];
}) {
  const { t } = useTranslation();
  const locate = useContext(LocateContext);
  const name = labels.building(m.cls, fmt.lang);
  const where = locate(m.x, m.y);
  const detail = [recipeName, where && t('factory.routes.near', { biome: where })].filter(Boolean).join(' · ');
  const out = (item ? m.outputs.find(o => o.item === item) : undefined) ?? m.outputs[0];
  const extra = m.kind === 'extractor' || hints.length > 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[minmax(12rem,20rem)_7.5rem_7rem_minmax(9rem,1fr)_8rem_auto]">
      <span className="flex min-w-0 items-center gap-2">
        <Picture cls={labels.buildingPicture(m.cls)} px={20} />
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          {detail && <span className="block truncate text-xs text-muted max-[899px]:text-sm">{detail}</span>}
        </span>
      </span>
      <span className="justify-self-end sm:order-last"><ShowOnMap worldId={worldId} ids={[m.id]} label={name} compact /></span>
      <span className="flex items-center gap-3 sm:contents">
        <ProductivityBar value={m.productivity} band={m.band} paused={m.paused} fmt={fmt} />
        <span className="text-xs whitespace-nowrap text-muted tabular-nums max-[899px]:text-sm" title={t('factory.clockHint')}>
          {t('factory.clock', { value: fmt.pct(m.clock) })}
          {m.powerShards > 0 && (
            <span className="ml-1 text-shard" role="img" aria-label={t('factory.shards', { count: m.powerShards })} title={t('factory.shards', { count: m.powerShards })}>
              {'◆'.repeat(Math.min(3, m.powerShards))}
            </span>
          )}
        </span>
      </span>
      {/* Surplus (more mined than taken off) is no real loss: grey, not red. */}
      <span className={`justify-self-end font-display font-semibold whitespace-nowrap tabular-nums sm:order-5 ${m.reasons.length > 0 && m.reasons.every(r => r === 'surplus') ? 'text-muted' : 'text-conflict'}`}>
        {!m.paused && lost !== null && lost >= MIN_LOSS ? `−${fmt.rate(lost, fluid)}` : ''}
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap gap-1 max-sm:empty:hidden sm:order-4 sm:col-span-1">{m.reasons.map(r => <ReasonBadge key={r} reason={r} />)}</span>
      {extra && (
        <span className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-7 text-xs text-muted tabular-nums max-[899px]:text-sm sm:order-last">
          {out && <span className="text-fg">{t('factory.items.outputOf', { actual: fmt.rate(out.actual, fluid), nominal: fmt.rate(out.nominal, fluid) })}</span>}
          {m.purity && (
            <span className="inline-flex items-center gap-1">
              <PurityDot purity={m.purity} />
              {t('factory.machine.purity', { purity: t(`resourceNodes.purity.${m.purity}`) })}
            </span>
          )}
          {m.belt && <span>{t('factory.machine.belt', { belt: labels.building(m.belt.cls, fmt.lang), rate: fmt.rate(m.belt.rate) })}</span>}
          {hints.map(h => <span key={h.kind} className={`font-medium ${HINT_TONE[h.kind]}`}>{hintText(h, labels, fmt, t)}</span>)}
        </span>
      )}
    </li>
  );
}
