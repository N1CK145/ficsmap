import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { evenClock, MAX_SHARDS, type ClockLimits, type Flow, type PlanStep, type Purity } from '../../../shared/planner.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { Badge } from '../../components/Badge.js';
import { FIELD_LABEL, fieldClass, NumberField } from '../../components/Field.js';
import { StatList, StatRow } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { buildingName, ChoiceSelect, powerText, usePurityOptions } from './controls.js';
import { formatNumber, formatRate, itemName, type Lang } from './format.js';
import { CycleBar, ItemSlot, MachineSection as Section, productionGrid, SLOT_LABEL, ShardSlots, SlotColumn } from './machineParts.js';
import { Picture, SHARD_CLASS, StepPicture, UseMark } from './pictures.js';
import { stepUse } from './stepText.js';
import { usePlanner } from './usePlanner.js';

export interface StepPanelProps {
  step: PlanStep;
  index: RecipeIndex;
  lang: Lang;
  minerId: string;
  limits: ClockLimits;
  /** The × in the title bar, with its accessible name. */
  onClose(): void;
  closeLabel: string;
  /** Layout of the window (height limits). */
  className?: string;
}

/**
 * A selected step as the game's machine window (`Window`): the building's picture (the product pinned to it), "4×
 * Constructor" and what it makes in the title bar, then "Made by", the inputs, the production cycle and the outputs,
 * the clock speed with its slider (the exact count and the clock speed for whole buildings under it), the Power Shard
 * slots it needs and the power. Extractors show their node purity instead of inputs.
 */
export function StepPanel({ step, index, lang, minerId, limits, onClose, closeLabel, className = '' }: StepPanelProps) {
  const { t } = useTranslation();
  const name = itemName(index, step.item, lang);
  const external = step.choice.kind === 'external';
  const covered = !external && step.machines < 1e-9;
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const title = external ? t('planner.option.external')
    : covered ? t('planner.diagram.covered')
    : t('planner.diagram.machines', { count: step.machinesCeil, name: buildingName(step, index, lang) ?? '' });
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
      subtitle={<>{name} · <span className="tabular-nums">{rate(step.item, covered ? step.fromByproducts : step.rate)}</span></>}
      icon={<StepPicture step={step} px={40} pin={18} />}
      actions={badges || undefined}
      onClose={onClose}
      closeLabel={closeLabel}
      className={className}
      bodyClassName="flex flex-col gap-4 overflow-y-auto p-3"
    >
      <Section title={t('planner.panel.recipe')}>
        <ChoiceSelect step={step} index={index} lang={lang} minerId={minerId} />
      </Section>

      {!external && !covered && <Production step={step} index={index} lang={lang} />}
      {!external && <ClockSection step={step} index={index} lang={lang} limits={limits} />}

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

/** Small print under the sections; empty parts are left out. */
function Notes({ children }: { children: ReactNode[] }) {
  const notes = children.filter((c): c is string => typeof c === 'string' && c !== '');
  if (notes.length === 0) return null;
  return <ul className="flex flex-col gap-1 border-t border-line pt-3 text-sm text-muted">{notes.map(n => <li key={n}>{n}</li>)}</ul>;
}

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
      <SlotColumn label={t('planner.panel.input')}>
        <ul className="flex flex-col gap-1.5">{inputs.map(f => <Slot key={f.item} flow={f} index={index} lang={lang} per={per(f)} />)}</ul>
      </SlotColumn>
    );
  } else if (step.purity) {
    left = (
      <div className="min-w-0">
        <p className={SLOT_LABEL}>{t('planner.panel.node')}</p>
        <label htmlFor={purityId} className={`mb-1 block ${FIELD_LABEL}`}>{t('planner.panel.purity')}</label>
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
      <div className={productionGrid(!!left)}>
        {left}
        <CycleBar
          seconds={seconds}
          caption={seconds !== undefined ? t('planner.panel.cycle', { value: formatNumber(seconds, lang, 2) }) : step.extractor && t('planner.panel.extraction')}
        />
        <SlotColumn label={t('planner.panel.output')}>
          <ul className="flex flex-col gap-1.5">{outputs.map(f => <Slot key={f.item} flow={f} index={index} lang={lang} per={per(f)} />)}</ul>
        </SlotColumn>
      </div>
    </Section>
  );
}

/** An item slot: picture, name, rate of all buildings, rate of one. */
function Slot({ flow, index, lang, per }: { flow: Flow; index: RecipeIndex; lang: Lang; per: string }) {
  const { t } = useTranslation();
  return <ItemSlot item={flow.item} name={itemName(index, flow.item, lang)} value={formatRate(index, flow.item, flow.rate, lang, t)} sub={per} />;
}

/**
 * The clock speed as slider and field (the field shows the clock speed in effect; while typing, what is typed), the
 * exact count with the clock speed for whole buildings, the Power Shard slots it fills and the power.
 */
function ClockSection({ step, index, lang, limits }: { step: PlanStep; index: RecipeIndex; lang: Lang; limits: ClockLimits }) {
  const { t } = useTranslation();
  const setStep = usePlanner(s => s.setStep);
  const input = usePlanner(s => s.steps[step.item]);
  const [draft, setDraft] = useState<string | null>(null);
  const min = limits.min * 100;
  const max = limits.max * 100;
  const clock = step.clock * 100;
  const pressurizer = step.pressurizer ? index.data.wellPressurizer : undefined;
  const per = step.machines > 1e-9 ? { min: step.power.min / step.machines, max: step.power.max / step.machines } : undefined;
  const shardsLabel = pressurizer ? `${t('planner.panel.shards')} (${pressurizer.name[lang]})` : t('planner.panel.shards');
  const exact = step.machines > 1e-9 && Math.abs(step.machines - step.machinesCeil) > 1e-6 ? step.machines : undefined;
  const even = exact !== undefined ? evenClock(step, limits) : undefined;
  const use = stepUse(step, lang, t);
  // A clock speed out of range keeps the last working plan: the field then shows what was entered, to correct it.
  const value = draft ?? input?.clock ?? String(Math.round(clock * 1e4) / 1e4);

  function onType(text: string) {
    setDraft(text);
    setStep(step.item, { clock: text });
  }

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
          onChange={e => { setDraft(null); setStep(step.item, { clock: e.target.value }); }}
          className="h-10 min-w-0 flex-1 accent-accent focus-ring"
        />
        <NumberField
          label={t('planner.stepClock')}
          hideLabel
          unit="%"
          min={min}
          max={max}
          step="any"
          value={value}
          onChange={e => onType(e.target.value)}
          onBlur={() => setDraft(null)}
          className="w-28 shrink-0"
        />
      </div>
      {use && (
        <p className="flex items-center gap-2 text-sm text-muted">
          {t('planner.use.label')}
          <UseMark use={use} className="text-base" />
        </p>
      )}
      {exact !== undefined && (
        <p className="text-sm text-muted tabular-nums">
          {t('planner.exact', { value: formatNumber(exact, lang, 3) })}
          {even !== undefined && <> · {t('planner.panel.even', { count: step.machinesCeil, clock: formatNumber(even * 100, lang, 2) })}</>}
        </p>
      )}
      <div>
        <p className={SLOT_LABEL}>{shardsLabel}</p>
        <ShardSlots used={step.shards} total={MAX_SHARDS} label={t('planner.panel.shardSlots', { used: step.shards, total: MAX_SHARDS })} />
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
