import { useContext, useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SHARDS, type ClockLimits, type Flow, type PlanStep, type Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { Badge } from '../../components/Badge.js';
import { FIELD_LABEL, fieldClass, NumberField } from '../../components/Field.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { StatList, StatRow } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { IconsContext, GameIcon } from '../machineWiki/icons.js';
import { buildingName, ChoiceSelect, powerText, usePurityOptions } from './controls.js';
import { formatNumber, formatRate, itemName, type Lang } from './format.js';
import { Picture, SHARD_CLASS, SOMERSLOOP_CLASS, stepPicture } from './pictures.js';
import { usePlanner } from './usePlanner.js';

/** "Alternate: Cast Screw" -> "Cast Screw"; the badge says it is an alternate. */
const ALT_PREFIX = /^[^:]{1,16}:\s+/;

export interface StepPanelProps {
  step: PlanStep;
  index: RecipeIndex;
  lang: Lang;
  minerId: string;
  /** The extractors' clock speed from the settings (placeholder of an extractor's field). */
  defaultClock: string;
  limits: ClockLimits;
  /** Somersloop slots of the step's building (machine data); left out when unknown or none. */
  sloops?: number;
  /** The × in the title bar, with its accessible name. */
  onClose(): void;
  closeLabel: string;
  /** Layout of the window (height limits). */
  className?: string;
}

/**
 * The selected step of the diagram as the game's machine window (`Window`): the building's picture, "4× Constructor"
 * and what it makes in the title bar, then the recipe and its picker, the inputs, the production cycle and the
 * outputs, the clock speed with its slider, the Power Shard slots it needs (and the Somersloop slots, which the plan
 * does not use) and the power. Extractors show their node purity instead of inputs.
 */
export function StepPanel({ step, index, lang, minerId, defaultClock, limits, sloops, onClose, closeLabel, className = '' }: StepPanelProps) {
  const { t } = useTranslation();
  const name = itemName(index, step.item, lang);
  const external = step.choice.kind === 'external';
  const covered = !external && step.machines < 1e-9;
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const picture = stepPicture(step);
  const exact = !external && !covered && Math.abs(step.machines - step.machinesCeil) > 1e-6
    ? t('planner.exact', { value: formatNumber(step.machines, lang, 3) }) : undefined;
  const title = external ? t('planner.option.external')
    : covered ? t('planner.diagram.covered')
    : t('planner.diagram.machines', { count: step.machinesCeil, name: buildingName(step, index, lang) ?? '' });
  const recipe = step.recipe;
  const pressurizer = step.pressurizer ? index.data.wellPressurizer : undefined;
  const badges = (step.targetRate > 0 || step.cycle) && (
    <span className="flex shrink-0 flex-col items-end gap-1">
      {step.targetRate > 0 && <Badge tone="accent">{t('planner.diagram.wantedBadge')}</Badge>}
      {step.cycle && <Badge tone="accent" title={t('planner.cycleHint')}>{t('planner.cycle')}</Badge>}
    </span>
  );

  return (
    <Window
      as="div"
      level={3}
      title={title}
      subtitle={<>{name} · <span className="tabular-nums">{rate(step.item, covered ? step.fromByproducts : step.rate)}</span>{exact && <> · {exact}</>}</>}
      icon={<Picture cls={picture.cls} px={40} dashed={picture.dashed} />}
      actions={badges || undefined}
      onClose={onClose}
      closeLabel={closeLabel}
      className={className}
      bodyClassName="flex flex-col gap-4 overflow-y-auto p-3"
    >
      <Section title={t('planner.panel.recipe')}>
        {recipe && (
          <p className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-semibold">{recipe.alternate ? recipe.name[lang].replace(ALT_PREFIX, '') : recipe.name[lang]}</span>
            {recipe.alternate && <Badge tone="accent">{t('planner.diagram.alt')}</Badge>}
          </p>
        )}
        <ChoiceSelect step={step} index={index} lang={lang} minerId={minerId} />
      </Section>

      {!external && !covered && <Production step={step} index={index} lang={lang} />}
      {!external && (
        <ClockSection step={step} index={index} lang={lang} defaultClock={defaultClock} limits={limits} sloops={covered ? undefined : sloops} />
      )}

      <Notes>
        {step.targetRate > 0 && step.targetRate < step.rate - 1e-9 && t('planner.forYou', { value: rate(step.item, step.targetRate) })}
        {!covered && step.fromByproducts > 1e-9 && t('planner.fromByproducts', { value: rate(step.item, step.fromByproducts) })}
        {covered && t('planner.noMachines')}
        {step.auto === 'loop' ? t('planner.autoLoop') : external && t('planner.external')}
        {pressurizer && t('planner.wellClock', { name: pressurizer.name[lang] })}
      </Notes>
    </Window>
  );
}

/** A titled part of the window: a section heading over its content. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeading as="h4" id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** Small print under the sections; empty parts are left out. */
function Notes({ children }: { children: ReactNode[] }) {
  const notes = children.filter((c): c is string => typeof c === 'string' && c !== '');
  if (notes.length === 0) return null;
  return <ul className="flex flex-col gap-1 border-t border-line pt-3 text-sm text-muted">{notes.map(n => <li key={n}>{n}</li>)}</ul>;
}

const SLOT_LABEL = 'mb-1 font-display text-xs font-semibold tracking-wider text-muted uppercase';

/** Inputs (or the resource node), the cycle and the outputs, each with the rate of all buildings and of one. */
function Production({ step, index, lang }: { step: PlanStep; index: RecipeIndex; lang: Lang }) {
  const { t } = useTranslation();
  const setStep = usePlanner(s => s.setStep);
  const purities = usePurityOptions();
  const purityId = useId();
  const per = (f: Flow) => t('planner.panel.perBuilding', { value: formatRate(index, f.item, f.rate / step.machines, lang, t) });
  const seconds = step.recipe ? step.recipe.duration / step.clock : undefined;
  const outputs = step.outputs.filter(f => f.rate > 1e-9);
  const inputs = step.inputs.filter(f => f.rate > 1e-9);

  let left: ReactNode = null;
  if (step.recipe) {
    left = (
      <div className="min-w-0">
        <p className={SLOT_LABEL}>{t('planner.panel.input')}</p>
        <ul className="flex flex-col gap-1.5">{inputs.map(f => <Slot key={f.item} flow={f} index={index} lang={lang} per={per(f)} />)}</ul>
      </div>
    );
  } else if (step.purity) {
    left = (
      <div className="min-w-0">
        <p className={SLOT_LABEL}>{t('planner.panel.node')}</p>
        <label htmlFor={purityId} className={`mb-1 block ${FIELD_LABEL}`}>{t('planner.purity')}</label>
        <select
          id={purityId}
          value={step.purity}
          onChange={e => setStep(step.item, { purity: e.target.value as Purity })}
          className={fieldClass({}, 'w-full text-sm')}
        >
          {purities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
    );
  }

  return (
    <Section title={t('planner.panel.production')}>
      <div className={`grid items-start gap-3 ${left ? 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'sm:grid-cols-[auto_minmax(0,1fr)]'}`}>
        {left}
        <div className="flex flex-col items-center gap-1 self-center px-1 text-center text-xs text-muted">
          <span aria-hidden="true" className="inline-block rotate-90 text-2xl leading-none text-accent sm:rotate-0">→</span>
          {seconds !== undefined ? (
            <>
              <span aria-hidden="true" className="block h-1.5 w-14 overflow-hidden bg-bg">
                <span
                  className="block h-full w-full origin-left bg-accent motion-safe:animate-[planner-cycle_var(--cycle)_linear_infinite]"
                  style={{ '--cycle': `${seconds}s` } as CSSProperties}
                />
              </span>
              <span>{t('planner.panel.cycle', { value: formatNumber(seconds, lang, 2) })}</span>
            </>
          ) : step.extractor && <span>{t('planner.panel.extraction')}</span>}
        </div>
        <div className="min-w-0">
          <p className={SLOT_LABEL}>{t('planner.panel.output')}</p>
          <ul className="flex flex-col gap-1.5">{outputs.map(f => <Slot key={f.item} flow={f} index={index} lang={lang} per={per(f)} />)}</ul>
        </div>
      </div>
    </Section>
  );
}

/** An item slot: picture, name, rate of all buildings, rate of one. */
function Slot({ flow, index, lang, per }: { flow: Flow; index: RecipeIndex; lang: Lang; per: string }) {
  const { t } = useTranslation();
  const name = itemName(index, flow.item, lang);
  return (
    <li className="flex min-w-0 items-center gap-2 chamfer border border-line bg-bg p-1.5">
      <Picture cls={flow.item} px={32} />
      <span className="min-w-0 flex-1 leading-5">
        <span className="block truncate text-sm" title={name}>{name}</span>
        <span className="block font-display text-base font-semibold tabular-nums">{formatRate(index, flow.item, flow.rate, lang, t)}</span>
        <span className="block truncate text-xs tabular-nums text-muted" title={per}>{per}</span>
      </span>
    </li>
  );
}

/** The clock speed as slider and field, the Power Shard slots it fills, the Somersloop slots and the power. */
function ClockSection({ step, index, lang, defaultClock, limits, sloops }: {
  step: PlanStep; index: RecipeIndex; lang: Lang; defaultClock: string; limits: ClockLimits; sloops?: number;
}) {
  const { t } = useTranslation();
  const setStep = usePlanner(s => s.setStep);
  const input = usePlanner(s => s.steps[step.item]);
  const min = limits.min * 100;
  const max = limits.max * 100;
  const clock = step.clock * 100;
  const pressurizer = step.pressurizer ? index.data.wellPressurizer : undefined;
  const per = step.machines > 1e-9 ? { min: step.power.min / step.machines, max: step.power.max / step.machines } : undefined;
  const shardsLabel = pressurizer ? `${t('planner.panel.shards')} (${pressurizer.name[lang]})` : t('planner.panel.shards');

  return (
    <Section title={t('planner.panel.clock')}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Math.min(max, Math.max(min, Math.round(clock)))}
          aria-label={t('planner.panel.clockSlider')}
          aria-valuetext={`${formatNumber(clock, lang)} %`}
          onChange={e => setStep(step.item, { clock: e.target.value })}
          className="h-10 min-w-0 flex-1 accent-accent focus-ring"
        />
        <NumberField
          label={t('planner.stepClock')}
          hideLabel
          unit="%"
          min={min}
          max={max}
          step="any"
          value={input?.clock ?? ''}
          placeholder={step.extractor ? defaultClock : '100'}
          onChange={e => setStep(step.item, { clock: e.target.value })}
          className="w-28 shrink-0"
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <p className={SLOT_LABEL}>{shardsLabel}</p>
          <ShardSlots used={step.shards} label={t('planner.panel.shardSlots', { used: step.shards, total: MAX_SHARDS })} />
        </div>
        {sloops !== undefined && sloops > 0 && (
          <div>
            <p className={SLOT_LABEL}>{t('planner.panel.sloops')}</p>
            <SloopSlots count={sloops} label={t('planner.panel.sloopSlots', { count: sloops })} />
            <p aria-hidden="true" className="mt-1 text-xs text-muted">{t('planner.panel.notModelled')}</p>
          </div>
        )}
      </div>
      {pressurizer ? (
        <p className="text-sm">
          <span className="text-muted">{t('planner.totalPower')}: </span>
          <span className="tabular-nums">{t('planner.panel.pressurizerPower', { name: pressurizer.name[lang], value: formatNumber(step.pressurizer!.power, lang, 1) })}</span>
        </p>
      ) : (
        <StatList className="border-t border-line">
          <StatRow
            label={t('planner.totalPower')}
            hint={per && t('planner.panel.perBuilding', { value: powerText(per, lang, t) })}
            value={powerText(step.power, lang, t)}
            tone="accent"
          />
        </StatList>
      )}
    </Section>
  );
}

const SLOT = 'flex size-10 items-center justify-center chamfer border bg-bg';

/** The three Power Shard slots; those the clock speed needs are filled. */
function ShardSlots({ used, label }: { used: number; label: string }) {
  const icons = useContext(IconsContext);
  return (
    <span role="img" aria-label={label} className="flex gap-1.5">
      {Array.from({ length: MAX_SHARDS }, (_, i) => (
        <span key={i} data-filled={i < used} className={`${SLOT} ${i < used ? 'border-shard' : 'border-dashed border-edge'}`}>
          {i < used && (icons?.has(SHARD_CLASS) ? <GameIcon cls={SHARD_CLASS} px={28} /> : <span aria-hidden="true" className="text-lg text-shard">◆</span>)}
        </span>
      ))}
    </span>
  );
}

/** The building's Somersloop slots, shown as not used: the plan does not model production amplification. */
function SloopSlots({ count, label }: { count: number; label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="flex gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${SLOT} border-dashed border-edge opacity-50`}>
          <GameIcon cls={SOMERSLOOP_CLASS} px={28} className="grayscale" />
        </span>
      ))}
    </span>
  );
}
