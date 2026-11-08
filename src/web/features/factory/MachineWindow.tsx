import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { starvesFor, type AnalysisData, type ItemRate, type MachineFlow, type MachineHint } from '../../../shared/factory/analysis.js';
import type { LineHint } from '../../../shared/factory/lines.js';
import { countOf, filledSlots } from '../../../shared/factory/inventory.js';
import { machineDetail, type FuelRate, type MachineDetail } from '../../../shared/factory/machineDetail.js';
import type { SnapshotBuilding, SnapshotInventory } from '../../../shared/factory/snapshot.js';
import { clockLimits, MAX_SHARDS } from '../../../shared/planner.js';
import { Badge, type BadgeTone } from '../../components/Badge.js';
import { StatList, StatRow } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import { powerText } from '../planner/controls.js';
import { CycleBar, ItemSlot, MachineSection, productionGrid, ShardSlots, SLOT_LABEL, SlotColumn, SomersloopSlots } from '../planner/machineParts.js';
import { PinnedPicture } from '../planner/pictures.js';
import { PurityDot } from '../resourceNodes/PurityPips.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { slotAmount, SlotCount } from './Inventory.js';
import { HINT_TONE, hintText, ReasonBadge, STATE_FILL, STATE_TEXT } from './parts.js';

/** How the game would sum up a machine: running, part load, standing, paused. */
export type RunState = 'running' | 'partLoad' | 'stopped' | 'paused';

/** Paused by the player; else standing below 1 %, part load below 90 %, running from there. */
export function runState(m: Pick<MachineFlow, 'paused' | 'band'>): RunState {
  if (m.paused) return 'paused';
  if (m.band === 'idle') return 'stopped';
  return m.band === 'throttled' ? 'partLoad' : 'running';
}

const RUN_TONE: Record<RunState, BadgeTone> = { running: 'success', partLoad: 'accent', stopped: 'danger', paused: 'neutral' };

export interface MachineWindowProps {
  m: MachineFlow;
  /** The game data the analysis used (recipes, machines). */
  data: AnalysisData;
  labels: FactoryLabels;
  fmt: FactoryFormat;
  /** Its hints with the production line's (`mergeHints`); the analysis's alone by default. */
  hints?: readonly (MachineHint | LineHint)[];
  onClose(): void;
  /** The title takes the focus from a script through it (a popup opened from the keyboard). */
  titleRef?: Ref<HTMLHeadingElement>;
  /** First in the body (the map's "New since" and productivity change). */
  top?: ReactNode;
  /** The machine's building in the snapshot: what lies in its slots (`in`, `out`, `fuel`). */
  building?: SnapshotBuilding;
  /** The snapshot carries inventories (`meta.inventories`): a slot without anything is then empty, not unknown. */
  inventories?: boolean;
  className?: string;
}

/** What lies in a machine's slots, when the snapshot knows it. */
interface Loaded {
  in?: SnapshotInventory;
  out?: SnapshotInventory;
  fuel?: SnapshotInventory;
  /** The snapshot carries inventories at all. */
  known: boolean;
}

/**
 * One machine of a snapshot as the game's machine window: its picture with the product pinned to it and its name in
 * the title bar; the status (productivity, running / part load / standing / paused, the reasons in words); the
 * recipe; production with the inputs, one cycle and the outputs, each "actual of nominal" per minute and what lay in
 * its slots when saved on the picture ("47", from `building`) (an extractor's node and purity instead of inputs, a
 * generator's fuels with the loaded one and its power instead); the clock speed with its Power Shard
 * and Somersloop slots; the power it draws or makes; the page's hints and the belt at its output. Every figure comes
 * from the analysis (`MachineFlow`) and the game data (`machineDetail`); read-only.
 */
export function MachineWindow({ m, data, labels, fmt, hints = m.hints, onClose, titleRef, top, building, inventories = false, className = '' }: MachineWindowProps) {
  const { t } = useTranslation();
  const name = labels.building(m.cls, fmt.lang);
  const detail = machineDetail(m, data);
  const main = m.outputs[0];
  const recipe = m.recipe ? data.recipes.recipes.get(m.recipe) : undefined;
  const loaded: Loaded = { in: building?.in, out: building?.out, fuel: building?.fuel, known: inventories && !!building };
  const subtitle = main ? <>{labels.item(main.item, fmt.lang)} · <span className="tabular-nums">{fmt.rate(main.actual, labels.isFluid(main.item))}</span></> : undefined;
  return (
    <Window
      as="div"
      level={3}
      title={name}
      titleRef={titleRef}
      subtitle={subtitle}
      icon={<PinnedPicture cls={labels.buildingPicture(m.cls)} item={main?.item} px={40} pin={18} />}
      onClose={onClose}
      closeLabel={t('factory.machineWindow.close', { name })}
      className={`min-h-0 ${className}`}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3"
    >
      {top}
      <Status m={m} fmt={fmt} />
      {recipe && (
        <MachineSection title={t('planner.panel.recipe')}>
          <p className="flex min-w-0 items-center gap-2 text-sm" data-testid="machine-recipe">
            {main && <GameIcon cls={main.item} px={24} placeholder />}
            <span className="min-w-0 break-words">{recipe.name[fmt.lang]}</span>
            {recipe.alternate && <Badge tone="accent">{t('factory.machineWindow.alternate')}</Badge>}
          </p>
        </MachineSection>
      )}
      <Production m={m} detail={detail} labels={labels} fmt={fmt} loaded={loaded} />
      <Clock m={m} detail={detail} fmt={fmt} most={clockLimits(data.recipes.data.clock).max} />
      <Power m={m} detail={detail} fmt={fmt} />
      <Hints m={m} hints={hints} labels={labels} fmt={fmt} />
    </Window>
  );
}

/** "87 %" large in its band's colour with a bar, the state as a badge, the reasons in words. */
function Status({ m, fmt }: { m: MachineFlow; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const state = runState(m);
  // "Paused" is the state badge already.
  const reasons = m.reasons.filter(r => r !== 'paused');
  return (
    <section aria-label={t('factory.machineWindow.status')} data-testid="machine-status" className="flex flex-col gap-2 chamfer border border-line bg-bg p-2.5">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={SLOT_LABEL.replace('mb-1 ', '')}>{t('factory.machineWindow.productivity')}</span>
          <span aria-hidden="true" className="relative block h-2 w-full overflow-hidden bg-line">
            <span className={`absolute inset-y-0 left-0 ${STATE_FILL[m.state]}`} style={{ width: `${Math.round(m.productivity * 100)}%` }} />
          </span>
        </span>
        <span className={`font-display text-3xl leading-none font-semibold tabular-nums ${STATE_TEXT[m.state]}`}>{fmt.pct(m.productivity)}</span>
        <Badge tone={RUN_TONE[state]}>{t(`factory.machineWindow.state.${state}`)}</Badge>
      </div>
      {reasons.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="machine-reasons">
          <span className="text-muted">{t('factory.machineWindow.because')}</span>
          {reasons.map(r => <ReasonBadge key={r} reason={r} />)}
        </p>
      )}
      {!m.measured && <p className="text-xs text-muted max-[899px]:text-sm">{t('factory.machineWindow.noMeasurement')}</p>}
    </section>
  );
}

/** "12.0/min" with "of 15.0/min" under it. */
function rateSlot(r: ItemRate, labels: FactoryLabels, fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string) {
  const fluid = labels.isFluid(r.item);
  return { value: fmt.rate(r.actual, fluid), sub: t('factory.machineWindow.of', { value: fmt.rate(r.nominal, fluid) }) };
}

/** What lies in a slot as the picture's count and its words for screen readers; nothing when the save did not say. */
function slotProps(inv: SnapshotInventory | undefined, item: string, loaded: Loaded, labels: FactoryLabels, fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string) {
  if (!loaded.known) return {};
  const n = countOf(inv, item);
  const amount = slotAmount(item, n, labels, fmt);
  return { count: n > 0 ? amount : undefined, countLabel: t('factory.inventory.inSlot', { amount }) };
}

/**
 * Inputs → cycle → outputs. Manufacturers: the recipe's inputs (one it lacks marked "Missing"), the cycle filling up
 * while it produces, the outputs. Extractors: the node with its purity, the outputs. Generators: the fuels it can burn
 * (one at a time) with the one loaded, its power. Each slot shows what lay in it when saved.
 */
function Production({ m, detail, labels, fmt, loaded }: { m: MachineFlow; detail: MachineDetail; labels: FactoryLabels; fmt: FactoryFormat; loaded: Loaded }) {
  const { t } = useTranslation();
  const lacking = (item: string) => m.starvedFor !== undefined && starvesFor(m, item);
  const producing = !m.paused && m.band !== 'idle';
  const outputs = m.outputs;
  let left: ReactNode = null;
  let right: ReactNode = null;
  let cycle: ReactNode = null;

  if (m.kind === 'manufacturer') {
    left = detail.inputs.length > 0 && (
      <SlotColumn label={t('planner.panel.input')}>
        <ul className="flex flex-col gap-1.5">
          {detail.inputs.map(r => (
            <ItemSlot
              key={r.item} item={r.item} name={labels.item(r.item, fmt.lang)} {...rateSlot(r, labels, fmt, t)}
              tone={lacking(r.item) ? 'danger' : 'default'} {...slotProps(loaded.in, r.item, loaded, labels, fmt, t)}
              note={lacking(r.item) ? <> <span className="text-xs font-semibold text-conflict">· {t('factory.machineWindow.missing')}</span></> : undefined}
            />
          ))}
        </ul>
      </SlotColumn>
    );
    cycle = (
      <CycleBar
        seconds={detail.cycleSeconds}
        running={producing}
        caption={detail.cycleSeconds !== undefined && t('planner.panel.cycle', { value: new Intl.NumberFormat(fmt.lang, { maximumFractionDigits: 2 }).format(detail.cycleSeconds) })}
      />
    );
  } else if (m.kind === 'extractor') {
    const res = outputs[0]?.item;
    left = res && m.purity && (
      <SlotColumn label={t('planner.panel.node')}>
        <ul className="flex flex-col gap-1.5">
          <ItemSlot
            item={res} name={labels.item(res, fmt.lang)}
            value={<span className="inline-flex items-center gap-1.5"><PurityDot purity={m.purity} />{t(`resourceNodes.purity.${m.purity}`)}</span>}
            sub={t('planner.panel.purity')}
          />
        </ul>
      </SlotColumn>
    );
    cycle = <CycleBar caption={t('planner.panel.extraction')} />;
  } else if (m.kind === 'generator') {
    left = (detail.fuels.length > 0 || loaded.fuel) && <Fuels fuels={detail.fuels} labels={labels} fmt={fmt} loaded={loaded} />;
    cycle = <CycleBar />;
    right = m.power && (
      <SlotColumn label={t('planner.panel.output')}>
        <ul className="flex flex-col gap-1.5">
          <li data-slot="power" className="flex min-w-0 items-center gap-2 chamfer border border-line bg-bg p-1.5">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center chamfer bg-panel text-2xl text-power">⚡</span>
            <span className="min-w-0 flex-1 leading-5">
              <span className="block font-display text-base font-semibold tabular-nums">{fmt.mw(m.power.actual)}</span>
              <span className="block text-xs text-muted tabular-nums">{t('factory.machineWindow.of', { value: fmt.mw(m.power.nominal) })}</span>
            </span>
          </li>
        </ul>
      </SlotColumn>
    );
  } else {
    return null;
  }

  if (outputs.length > 0 && !right) {
    right = (
      <SlotColumn label={t('planner.panel.output')}>
        <ul className="flex flex-col gap-1.5">
          {outputs.map(r => (
            <ItemSlot key={r.item} item={r.item} name={labels.item(r.item, fmt.lang)} {...rateSlot(r, labels, fmt, t)} {...slotProps(loaded.out, r.item, loaded, labels, fmt, t)} />
          ))}
        </ul>
      </SlotColumn>
    );
  }
  if (!left && !right) return null;
  return (
    <MachineSection title={t('planner.panel.production')}>
      <div className={productionGrid(!!left)} data-testid="machine-production">
        {left}
        {cycle}
        {right ?? <span />}
      </div>
    </MachineSection>
  );
}

/**
 * A generator's fuels: it burns one of them; each with what it takes per minute at its clock speed. The one in its fuel
 * slot is marked "Loaded" with the count on its picture (also when the game data does not list it), the supplement
 * (water) with what is in its slot; with inventories known and nothing loaded, "No fuel loaded".
 */
function Fuels({ fuels, labels, fmt, loaded }: { fuels: readonly FuelRate[]; labels: FactoryLabels; fmt: FactoryFormat; loaded: Loaded }) {
  const { t } = useTranslation();
  const inSlot = new Map<string, number>();
  for (const s of loaded.fuel ? filledSlots(loaded.fuel) : []) inSlot.set(s.item, (inSlot.get(s.item) ?? 0) + s.count);
  const supplements = new Set(fuels.map(f => f.supplement?.item).filter((i): i is string => !!i));
  // What lies in the fuel slot but is no listed fuel (nor a supplement): shown too, so the window says what is loaded.
  const extra = [...inSlot.keys()].filter(i => !fuels.some(f => f.item === i) && !supplements.has(i));
  const rows: FuelRate[] = [...fuels, ...extra.map(item => ({ item }))];
  const fuelLoaded = rows.some(f => (inSlot.get(f.item) ?? 0) > 0);
  return (
    <SlotColumn label={t('factory.machineWindow.fuels')}>
      <ul className="flex flex-col gap-1" data-testid="machine-fuels">
        {rows.map(f => {
          const n = inSlot.get(f.item) ?? 0;
          const sup = f.supplement ? inSlot.get(f.supplement.item) ?? 0 : 0;
          return (
            <li key={f.item} data-fuel={f.item} data-loaded={n > 0 || undefined}
              className={`flex min-w-0 items-center gap-2 chamfer border bg-bg p-1 text-sm ${n > 0 ? 'border-accent' : 'border-line'}`}>
              <span className="relative shrink-0">
                <GameIcon cls={f.item} px={24} placeholder />
                {n > 0 && <SlotCount>{slotAmount(f.item, n, labels, fmt)}</SlotCount>}
              </span>
              <span className="min-w-0 flex-1 leading-5">
                <span className="block break-words">{labels.item(f.item, fmt.lang)}</span>
                {n > 0 && (
                  <span className="block text-xs font-semibold text-accent tabular-nums max-[899px]:text-sm">
                    {t('factory.machineWindow.loaded', { amount: slotAmount(f.item, n, labels, fmt) })}
                  </span>
                )}
                {f.perMinute !== undefined && <span className="block text-xs text-muted tabular-nums">{fmt.rate(f.perMinute, labels.isFluid(f.item))}</span>}
                {f.supplement && (
                  <span className="block text-xs text-muted tabular-nums">
                    {t('factory.machineWindow.supplement', { item: labels.item(f.supplement.item, fmt.lang), rate: fmt.rate(f.supplement.amount, labels.isFluid(f.supplement.item)) })}
                    {sup > 0 && n > 0 && ` · ${t('factory.machineWindow.loaded', { amount: slotAmount(f.supplement.item, sup, labels, fmt) })}`}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {loaded.known && !fuelLoaded && <p className="mt-1 text-sm font-medium text-conflict" data-testid="machine-no-fuel">{t('factory.machineWindow.noFuelLoaded')}</p>}
    </SlotColumn>
  );
}

/** The clock speed (read-only, a bar up to 250 %), the Power Shard slots and, where it has them, the Somersloop slots. */
function Clock({ m, detail, fmt, most }: { m: MachineFlow; detail: MachineDetail; fmt: FactoryFormat; most: number }) {
  const { t } = useTranslation();
  const sloops = Math.max(detail.sloopSlots, m.somersloops);
  return (
    <MachineSection title={t('planner.panel.clock')}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="relative block h-2 min-w-0 flex-1 overflow-hidden bg-bg">
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.min(100, (m.clock / most) * 100)}%` }} />
          {/* 100 % as a tick: beyond it the shards. */}
          <span className="absolute inset-y-0 w-px bg-edge" style={{ left: `${100 / most}%` }} />
        </span>
        <span className="font-display text-xl font-semibold tabular-nums" data-testid="machine-clock">{fmt.pct(m.clock)}</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className={SLOT_LABEL}>{t('planner.panel.shards')}</p>
          <ShardSlots used={m.powerShards} total={MAX_SHARDS} label={t('planner.panel.shardSlots', { used: m.powerShards, total: MAX_SHARDS })} />
        </div>
        {sloops > 0 && (
          <div>
            <p className={SLOT_LABEL}>{t('factory.machineWindow.somersloops')}</p>
            <SomersloopSlots used={m.somersloops} total={sloops} label={t('factory.machineWindow.sloopSlots', { used: m.somersloops, total: sloops })} />
            {m.boost > 1 && <p className="mt-1 text-xs text-muted tabular-nums">{t('factory.machineWindow.boost', { value: new Intl.NumberFormat(fmt.lang, { maximumFractionDigits: 2 }).format(m.boost) })}</p>}
          </div>
        )}
      </div>
    </MachineSection>
  );
}

/** What it draws while it runs at its clock speed, or (generators) what it makes of what it could. */
function Power({ m, detail, fmt }: { m: MachineFlow; detail: MachineDetail; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  if (!detail.powerUse && !m.power) return null;
  return (
    <MachineSection title={t('factory.machineWindow.power')}>
      <StatList>
        {detail.powerUse && (
          <StatRow
            label={t('factory.machineWindow.powerUse')}
            hint={t('factory.machineWindow.atClock', { clock: fmt.pct(m.clock) })}
            value={powerText(detail.powerUse, fmt.lang, t)}
            tone="accent"
          />
        )}
        {m.power && (
          <StatRow
            label={t('factory.machineWindow.powerMade')}
            value={t('factoryMap.info.actualOf', { actual: fmt.mw(m.power.actual), at: fmt.mw(m.power.nominal) })}
            tone="accent"
          />
        )}
      </StatList>
    </MachineSection>
  );
}

/** The belt at its output and the hints (a belt that limits it, no belt, overclocking that brings nothing). */
function Hints({ m, hints, labels, fmt }: { m: MachineFlow; hints: readonly (MachineHint | LineHint)[]; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  if (hints.length === 0 && !m.belt) return null;
  return (
    <MachineSection title={t('factory.machineWindow.hints')}>
      <ul className="flex flex-col gap-1 text-sm" data-testid="machine-hints">
        {m.belt && <li className="text-muted">{t('factory.machineWindow.belt', { belt: labels.building(m.belt.cls, fmt.lang), rate: fmt.rate(m.belt.rate) })}</li>}
        {hints.map(h => <li key={h.kind} className={`font-medium ${HINT_TONE[h.kind]}`}>{hintText(h, labels, fmt, t)}</li>)}
      </ul>
    </MachineSection>
  );
}
