import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { descriptorClass } from '../../../shared/machines.js';
import { clockLimits, MAX_SHARDS, plan, PURITY_FACTOR, type ClockLimits, type PlanResult, type PlanStep, type Purity, type StepSettings } from '../../../shared/planner.js';
import { miners as minersOf, type RecipeIndex } from '../../../shared/recipes.js';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { FIELD_LABEL, fieldClass, NumberField } from '../../components/Field.js';
import { Fold } from '../../components/Fold.js';
import { IconButton } from '../../components/IconButton.js';
import { CloseIcon } from '../../components/icons.js';
import { PageActions } from '../../components/PageActions.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { StatList, StatRow, StatTile, TileValue } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { GameIcon, IconsContext, useItemIcons } from '../machineWiki/icons.js';
import { useMachineData } from '../machineWiki/useMachineWiki.js';
import { prefersReducedMotion } from '../map/motion.js';
import { buildingName, ChoiceSelect, flows, powerText, powerValue, usePurityOptions } from './controls.js';
import { formatNumber, formatRate, itemName, langOf, type Lang } from './format.js';
import { ItemPicker } from './ItemPicker.js';
import { PlanDiagram } from './PlanDiagram.js';
import { StepPanel } from './StepPanel.js';
import { parseNumber, usePlanner, type PlannerView } from './usePlanner.js';
import { useRecipes } from './useRecipes.js';

/** What the empty planner offers to try: a small chain the dataset has (left out when it does not). */
export const EXAMPLE = { item: 'Desc_IronPlateReinforced_C', rate: '5' } as const;

/**
 * The planner for a dataset version: loads its recipe data and the dataset's pictures (part `icons`, for items,
 * machines and extractors), then shows the form and the plan.
 */
export function Planner({ version }: { version: string }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.resolvedLanguage ?? i18n.language);
  const { index, error } = useRecipes(version);
  const icons = useItemIcons(version);
  if (error) return <p role="alert" className="text-conflict">{t('planner.loadFailed')}</p>;
  if (index === undefined) return <p className="text-muted">{t('common.loading')}</p>;
  if (index === null) return <p>{t('planner.noData')}</p>;
  return (
    <IconsContext.Provider value={icons}>
      <PlannerBody index={index} lang={lang} version={version} />
    </IconsContext.Provider>
  );
}

/**
 * The page: what you need (with the extractor settings folded away) beside the answer, the totals; under both the
 * production steps as a diagram or a list, a selected step's machine window beside the diagram on a wide page. The
 * view switch and "Start over" sit in the page header.
 */
function PlannerBody({ index, lang, version }: { index: RecipeIndex; lang: Lang; version: string }) {
  const { t } = useTranslation();
  const targets = usePlanner(s => s.targets);
  const choices = usePlanner(s => s.choices);
  const settings = usePlanner(s => s.settings);
  const stepInputs = usePlanner(s => s.steps);
  const miners = useMemo(() => minersOf(index), [index]);
  const limits = useMemo(() => clockLimits(index.data.clock), [index]);
  const minerId = miners.some(m => m.id === settings.miner) ? settings.miner! : miners[0]?.id ?? '';

  const result = useMemo<PlanResult | null>(() => {
    const wanted = targets.flatMap(tg => (tg.item ? [{ item: tg.item, rate: parseNumber(tg.rate) }] : []));
    if (wanted.length === 0) return null;
    const steps: Record<string, StepSettings> = {};
    for (const [item, st] of Object.entries(stepInputs)) {
      steps[item] = {
        ...(st.clock !== undefined ? { clock: parseNumber(st.clock) / 100 } : {}),
        ...(st.purity ? { purity: st.purity } : {}),
      };
    }
    return plan(index, {
      targets: wanted, choices, steps,
      settings: { miner: minerId, clock: parseNumber(settings.clock) / 100, purity: settings.purity },
    });
  }, [index, targets, choices, stepInputs, settings, minerId]);
  // A setting that breaks the plan (a clock speed out of range, a loop that cannot work) keeps the last working
  // plan on screen, so the step editor with the field to correct stays reachable.
  const lastOk = useRef<Extract<PlanResult, { ok: true }> | null>(null);
  if (result?.ok) lastOk.current = result;
  const stale = result !== null && !result.ok && result.error !== 'no-targets' && result.error !== 'unknown-item' ? lastOk.current : null;
  const shown = result?.ok ? result : stale;
  const failed = result !== null && !result.ok ? result : null;

  return (
    <div className="flex flex-col gap-4">
      <PlannerActions hasPlan={shown !== null} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start 2xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <Targets index={index} lang={lang} minerId={minerId} miners={miners.map(m => ({ value: m.id, label: m.name[lang] }))} limits={limits} />
        <div className="flex min-w-0 flex-col gap-3">
          {failed && <PlanError result={failed} index={index} lang={lang} limits={limits} />}
          {stale && <p className="text-sm text-muted">{t('planner.lastWorking')}</p>}
          {shown ? <Totals result={shown} index={index} lang={lang} /> : !failed && <EmptyResult index={index} lang={lang} />}
        </div>
      </div>
      {shown && (
        <Steps steps={shown.steps} index={index} lang={lang} minerId={minerId} defaultClock={settings.clock} defaultPurity={settings.purity} limits={limits} version={version} />
      )}
    </div>
  );
}

/** In the page header: the view of the steps (while there is a plan) and "Start over" (once something is entered). */
function PlannerActions({ hasPlan }: { hasPlan: boolean }) {
  const { t } = useTranslation();
  const view = usePlanner(s => s.view);
  const setView = usePlanner(s => s.setView);
  const reset = usePlanner(s => s.reset);
  const entered = usePlanner(s => s.targets.length > 1 || s.targets.some(tg => tg.item !== null));
  const views: { value: PlannerView; label: string }[] = [
    { value: 'diagram', label: t('planner.viewOption.diagram') },
    { value: 'list', label: t('planner.viewOption.list') },
  ];
  if (!hasPlan && !entered) return null;
  return (
    <PageActions>
      {hasPlan && <SegmentedControl label={t('planner.view')} options={views} value={view} onChange={setView} />}
      {entered && <Button size="sm" variant="ghost" onClick={reset}>{t('planner.reset')}</Button>}
    </PageActions>
  );
}

interface StepsProps {
  steps: PlanStep[]; index: RecipeIndex; lang: Lang; minerId: string; defaultClock: string; defaultPurity: Purity; limits: ClockLimits; version: string;
}

/**
 * The plan's steps in a window, as a diagram (a node opens its machine window, beside the diagram on a wide page, else
 * below it) or as a list.
 */
function Steps({ steps, index, lang, minerId, defaultClock, defaultPurity, limits, version }: StepsProps) {
  const { t } = useTranslation();
  const view = usePlanner(s => s.view);
  const [selected, setSelected] = useState<string | null>(null);
  const editorId = useId();
  const nodePrefix = useId();
  const nodeId = (item: string) => `${nodePrefix}${item}`;
  const step = view === 'diagram' ? steps.find(st => st.item === selected) : undefined;
  // Somersloop slots per building, for the step panel; the machine data loads when a step is first opened.
  const machines = useMachineData(version, step !== undefined).data;
  const sloops = step?.recipe ? machines?.machines.find(m => m.id === step.recipe!.machine)?.stats.somersloopSlots : undefined;
  function closeEditor() {
    if (step) document.getElementById(nodeId(step.item))?.focus();
    setSelected(null);
  }
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <Window level={3} title={t('planner.steps')} className="min-w-0 flex-1" bodyClassName={view === 'diagram' ? '' : 'p-3'}>
        {view === 'diagram' ? (
          <PlanDiagram
            steps={steps} index={index} lang={lang} selected={step ? step.item : null} defaultPurity={defaultPurity}
            onSelect={item => setSelected(item === selected ? null : item)} editorId={editorId} nodeId={nodeId}
          />
        ) : (
          <ol className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
            {steps.map(st => <StepRow key={st.item} step={st} index={index} lang={lang} minerId={minerId} defaultClock={defaultClock} />)}
          </ol>
        )}
      </Window>
      {step && (
        <StepEditor id={editorId} item={step.item} name={itemName(index, step.item, lang)}>
          <StepPanel
            step={step} index={index} lang={lang} minerId={minerId} defaultClock={defaultClock} limits={limits} sloops={sloops}
            onClose={closeEditor} closeLabel={t('planner.diagram.close', { item: itemName(index, step.item, lang) })} className="min-h-0"
          />
        </StepEditor>
      )}
    </div>
  );
}

/**
 * Where the selected node's machine window goes: beside the diagram on a wide page (sticky while the page scrolls, its
 * content scrolling when taller than the screen), below it on a narrower one; scrolled into view when another step is
 * selected.
 */
function StepEditor({ id, item, name, children }: { id: string; item: string; name: string; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [item]);
  return (
    <section
      ref={ref}
      id={id}
      aria-label={t('planner.diagram.editor', { item: name })}
      className="flex flex-col xl:sticky xl:top-0 xl:max-h-[calc(100dvh-9rem)] xl:w-[30rem] xl:shrink-0 2xl:w-[34rem]"
    >
      {children}
    </section>
  );
}

function Targets({ index, lang, minerId, miners, limits }: {
  index: RecipeIndex; lang: Lang; minerId: string; miners: { value: string; label: string }[]; limits: ClockLimits;
}) {
  const { t } = useTranslation();
  const targets = usePlanner(s => s.targets);
  const setTarget = usePlanner(s => s.setTarget);
  const addTarget = usePlanner(s => s.addTarget);
  const removeTarget = usePlanner(s => s.removeTarget);
  const removable = targets.length > 1 || targets.some(tg => tg.item !== null);
  return (
    <Window level={3} title={t('planner.needs')} bodyClassName="flex flex-col gap-3 p-3">
      <ul className="flex flex-col gap-2">
        {targets.map((tg, i) => {
          const name = tg.item ? itemName(index, tg.item, lang) : t('planner.itemN', { n: i + 1 });
          const fluid = tg.item ? index.items.get(tg.item)?.form !== 'solid' : false;
          return (
            <li key={tg.key} className="flex flex-wrap items-center gap-2">
              <ItemPicker index={index} lang={lang} value={tg.item} label={t('planner.itemN', { n: i + 1 })} onChange={item => setTarget(tg.key, { item })} />
              <div className="flex items-center gap-1">
                <NumberField
                  label={t('planner.rateFor', { item: name })}
                  hideLabel
                  unit={fluid ? t('planner.unit.fluidPerMin') : t('planner.unit.perMin')}
                  min={0}
                  step="any"
                  value={tg.rate}
                  onChange={e => setTarget(tg.key, { rate: e.target.value })}
                  className="w-32"
                />
                {removable && (
                  <IconButton aria-label={t('planner.remove', { item: name })} title={t('planner.remove', { item: name })} onClick={() => removeTarget(tg.key)}>
                    <CloseIcon />
                  </IconButton>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Button size="sm" onClick={addTarget} className="self-start">{t('planner.add')}</Button>
      <ExtractorSettings minerId={minerId} miners={miners} limits={limits} />
    </Window>
  );
}

/** The extractors' defaults (miner, node purity, clock speed), folded away with the values in effect as its summary. */
function ExtractorSettings({ minerId, miners, limits }: { minerId: string; miners: { value: string; label: string }[]; limits: ClockLimits }) {
  const { t } = useTranslation();
  const settings = usePlanner(s => s.settings);
  const setSettings = usePlanner(s => s.setSettings);
  const purities = usePurityOptions();
  const miner = miners.find(m => m.value === minerId)?.label;
  const purity = t(`planner.purityOption.${settings.purity}`, { factor: PURITY_FACTOR[settings.purity] });
  const summary = [miner, purity, `${settings.clock.trim() || '–'} %`].filter(Boolean).join(' · ');
  return (
    <Fold title={t('planner.extractors')} summary={summary} className="-mx-3 -mb-3 border-t border-line" summaryClassName="px-3 py-1" bodyClassName="flex flex-col gap-3 px-3 pt-1 pb-3">
      {miners.length > 0 && (
        <div className="flex flex-col items-start gap-1">
          <span className={FIELD_LABEL}>{t('planner.miner')}</span>
          <SegmentedControl label={t('planner.miner')} options={miners} value={minerId} onChange={miner => setSettings({ miner })} />
        </div>
      )}
      <div className="flex flex-col items-start gap-1">
        <span className={FIELD_LABEL}>{t('planner.purity')}</span>
        <SegmentedControl<Purity> label={t('planner.purity')} options={purities} value={settings.purity} onChange={purity => setSettings({ purity })} />
        <p className="text-xs text-muted">{t('planner.purityHint')}</p>
      </div>
      <NumberField
        label={t('planner.clock')}
        unit="%"
        hint={t('planner.clockHint', { ...percentRange(limits), per: limits.perShard * 100, slots: MAX_SHARDS })}
        min={limits.min * 100}
        max={limits.max * 100}
        step="any"
        value={settings.clock}
        onChange={e => setSettings({ clock: e.target.value })}
        boxClassName="max-w-40"
      />
    </Fold>
  );
}

/** The clock speed range in percent, for messages. */
const percentRange = (limits: ClockLimits) => ({ min: limits.min * 100, max: limits.max * 100 });

function PlanError({ result, index, lang, limits }: { result: Extract<PlanResult, { ok: false }>; index: RecipeIndex; lang: Lang; limits: ClockLimits }) {
  const { t } = useTranslation();
  let text: string;
  if (result.error === 'cycle') text = t('planner.error.cycle', { items: result.items.map(i => itemName(index, i, lang)).join(', ') });
  else if (result.error === 'invalid-settings') text = t('planner.error.invalidSettings', percentRange(limits));
  else if (result.error === 'invalid-clock') text = t('planner.error.invalidClock', { item: itemName(index, result.item, lang), ...percentRange(limits) });
  else if (result.error === 'unknown-item') text = t('planner.error.unknownItem', { item: result.item });
  else text = t('planner.error.noTargets');
  return <p role="alert" className="chamfer border border-conflict/60 bg-conflict/10 p-3 text-sm">{text}</p>;
}

/** Before anything is picked: what the planner will show, and one example to try. */
function EmptyResult({ index, lang }: { index: RecipeIndex; lang: Lang }) {
  const { t } = useTranslation();
  const first = usePlanner(s => s.targets[0]);
  const setTarget = usePlanner(s => s.setTarget);
  const example = index.plannable.some(i => i.id === EXAMPLE.item);
  return (
    <Window level={3} title={t('planner.totals')} bodyClassName="flex flex-col items-start gap-3 p-3">
      <p className="text-muted">{t('planner.empty')}</p>
      {example && first && (
        <Button size="sm" onClick={() => setTarget(first.key, { item: EXAMPLE.item, rate: EXAMPLE.rate })}>
          <GameIcon cls={EXAMPLE.item} px={20} />
          {t('planner.example', { item: itemName(index, EXAMPLE.item, lang), rate: formatRate(index, EXAMPLE.item, Number(EXAMPLE.rate), lang, t) })}
        </Button>
      )}
    </Window>
  );
}

interface StepRowProps {
  step: PlanStep; index: RecipeIndex; lang: Lang; minerId: string; defaultClock: string;
}

/** A step in the list view: recipe, clock speed and purity, buildings and power, inputs and by-products. */
function StepRow({ step, index, lang, minerId, defaultClock }: StepRowProps) {
  const { t } = useTranslation();
  const setStep = usePlanner(s => s.setStep);
  const input = usePlanner(s => s.steps[step.item]);
  const purities = usePurityOptions();
  const purityId = useId();
  const name = itemName(index, step.item, lang);
  const building = buildingName(step, index, lang);
  // A resource well step's clock speed and shards are its pressurizer's.
  const pressurizer = step.pressurizer ? index.data.wellPressurizer?.name[lang] : undefined;
  const whole = Math.abs(step.machines - step.machinesCeil) < 1e-6;

  return (
    <li className="flex flex-col gap-2 chamfer border border-line bg-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="flex min-w-0 items-center gap-2 font-semibold">
          <GameIcon cls={step.item} px={24} />
          {name}
          {step.cycle && <Badge tone="accent" title={t('planner.cycleHint')}>{t('planner.cycle')}</Badge>}
        </h4>
        <span className="font-display text-lg font-semibold tabular-nums">{formatRate(index, step.item, step.rate, lang, t)}</span>
      </div>
      {step.targetRate > 0 && step.targetRate < step.rate - 1e-9 && (
        <p className="text-sm text-muted">{t('planner.forYou', { value: formatRate(index, step.item, step.targetRate, lang, t) })}</p>
      )}
      <ChoiceSelect step={step} index={index} lang={lang} minerId={minerId} />
      {step.choice.kind !== 'external' && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <NumberField
            label={t('planner.stepClock')}
            size="sm"
            unit="%"
            step="any"
            value={input?.clock ?? ''}
            placeholder={step.extractor ? defaultClock : '100'}
            onChange={e => setStep(step.item, { clock: e.target.value })}
            className="w-28"
          />
          {step.purity && (
            <div className="flex flex-col gap-1">
              <label htmlFor={purityId} className={FIELD_LABEL}>{t('planner.purity')}</label>
              <select
                id={purityId}
                value={step.purity}
                onChange={e => setStep(step.item, { purity: e.target.value as Purity })}
                className={fieldClass({ size: 'sm' })}
              >
                {purities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          )}
          {step.shards > 0 && (
            <span className="pb-1.5 text-sm text-muted">
              {pressurizer ? t('planner.shardsPressurizer', { count: step.shards, name: pressurizer }) : t('planner.shards', { count: step.shards })}
            </span>
          )}
        </div>
      )}
      {pressurizer && <p className="text-sm text-muted">{t('planner.wellClock', { name: pressurizer })}</p>}
      {step.fromByproducts > 1e-9 && (
        <p className="text-sm text-muted">{t('planner.fromByproducts', { value: formatRate(index, step.item, step.fromByproducts, lang, t) })}</p>
      )}
      {step.auto === 'loop' && <p className="text-sm text-muted">{t('planner.autoLoop')}</p>}
      {step.choice.kind === 'external'
        ? <p className="text-sm text-muted">{t('planner.external')}</p>
        : step.machines < 1e-9 ? <p className="text-sm text-muted">{t('planner.noMachines')}</p> : (
          <p className="text-sm">
            <span className="font-medium">{t('planner.diagram.machines', { count: step.machinesCeil, name: building ?? '' })}</span>
            {!whole && <span className="text-muted"> ({t('planner.exact', { value: formatNumber(step.machines, lang, 3) })})</span>}
            <span className="text-muted"> · {powerText(step.power, lang, t)}</span>
          </p>
        )}
      {step.inputs.length > 0 && <p className="text-sm"><span className="text-muted">{t('planner.inputs')}:</span> {flows(index, step.inputs, lang, t)}</p>}
      {step.byproducts.length > 0 && <p className="text-sm"><span className="text-muted">{t('planner.byproducts')}:</span> {flows(index, step.byproducts, lang, t)}</p>}
    </li>
  );
}

/**
 * The answer: power and the number of buildings as big figures, then the raw resources with their extractors and the
 * buildings by kind (side by side when the window is wide enough), items supplied from outside and the surplus, each
 * row with the game's picture; short notes at the end.
 */
function Totals({ result, index, lang }: { result: Extract<PlanResult, { ok: true }>; index: RecipeIndex; lang: Lang }) {
  const { t } = useTranslation();
  const { totals } = result;
  const variable = result.steps.some(st => st.power.max - st.power.min > 1e-9);
  const pressurizer = index.data.wellPressurizer;
  const nameOf = (id: string) => index.machines.get(id)?.name[lang] ?? index.extractors.get(id)?.name[lang] ?? id;
  const exact = (ceil: number, value: number) =>
    (Math.abs(ceil - value) > 1e-6 ? t('planner.exact', { value: formatNumber(value, lang, 3) }) : undefined);
  const buildings = totals.machines.reduce((sum, m) => sum + m.machinesCeil, 0);
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const picture = (cls: string) => <GameIcon cls={cls} px={24} placeholder />;
  return (
    <Window level={3} title={t('planner.totals')} bodyClassName="@container flex flex-col gap-4 p-3">
      <dl className="grid grid-cols-2 gap-2">
        <StatTile main label={t('planner.totalPower')} sub={variable ? t('planner.variableShort') : undefined}>
          <TileValue value={powerValue(totals.power, lang)} unit={t('planner.unit.mw')} />
        </StatTile>
        <StatTile label={t('planner.buildings')}>{formatNumber(buildings, lang, 0)}</StatTile>
      </dl>
      <div className="grid gap-x-6 gap-y-4 @lg:grid-cols-2">
        <Block title={t('planner.raw')}>
          {totals.raw.length === 0 ? <p className="py-1.5 text-sm text-muted">{t('planner.none')}</p> : (
            <StatList>
              {totals.raw.map(r => (
                <StatRow
                  key={`${r.item}:${r.extractor}`} icon={picture(r.item)} label={itemName(index, r.item, lang)} value={rate(r.item, r.rate)}
                  hint={[t('planner.diagram.machines', { count: r.machinesCeil, name: nameOf(r.extractor) }), exact(r.machinesCeil, r.machines)].filter(Boolean).join(' · ')}
                />
              ))}
            </StatList>
          )}
        </Block>
        <Block title={t('planner.buildings')}>
          <StatList>
            {totals.machines.map(m => (
              <StatRow key={m.building} icon={picture(descriptorClass(m.building))} label={nameOf(m.building)} hint={exact(m.machinesCeil, m.machines)} value={formatNumber(m.machinesCeil, lang, 0)} />
            ))}
          </StatList>
        </Block>
        {totals.external.length > 0 && (
          <Block title={t('planner.externalInputs')}>
            <StatList>
              {totals.external.map(f => <StatRow key={f.item} icon={picture(f.item)} label={itemName(index, f.item, lang)} value={rate(f.item, f.rate)} />)}
            </StatList>
          </Block>
        )}
        {totals.byproducts.length > 0 && (
          <Block title={t('planner.surplus')}>
            <StatList>
              {totals.byproducts.map(f => <StatRow key={f.item} icon={picture(f.item)} label={itemName(index, f.item, lang)} value={rate(f.item, f.rate)} tone="success" />)}
            </StatList>
          </Block>
        )}
      </div>
      <ul className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
        {pressurizer && totals.pressurizers.map(p => (
          <li key={p.item}>
            {t('planner.wellNote', {
              item: itemName(index, p.item, lang), name: pressurizer.name[lang], power: formatNumber(p.power, lang, 1),
              clock: p.clock * 100, shards: p.shards,
            })}
          </li>
        ))}
        <li>{t('planner.roundedNote')}</li>
        <li>{t('planner.gameModeNote')}</li>
      </ul>
    </Window>
  );
}

/** A titled list in the totals. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <SectionHeading as="h4" id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}
