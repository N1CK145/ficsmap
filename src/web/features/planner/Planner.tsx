import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { descriptorClass } from '../../../shared/machines.js';
import { clockLimits, MAX_SHARDS, plan, PURITY_FACTOR, type ClockLimits, type PlanResult, type PlanStep, type Purity, type StepSettings } from '../../../shared/planner.js';
import { miners as minersOf, type RecipeIndex } from '../../../shared/recipes.js';
import { worldPath } from '../../app/pages.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { FIELD_LABEL, NumberField } from '../../components/Field.js';
import { Fold } from '../../components/Fold.js';
import { IconButton } from '../../components/IconButton.js';
import { CloseIcon, FlowIcon, MenuIcon } from '../../components/icons.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { StatList, StatRow, StatTile, TileValue } from '../../components/StatRow.js';
import type { ToastApi } from '../../components/Toast.js';
import { Window } from '../../components/Window.js';
import { GameIcon, IconsContext, useItemIcons } from '../machineWiki/icons.js';
import { prefersReducedMotion } from '../map/motion.js';
import { useNodeLayer, useResourceNodeFile } from '../resourceNodes/useResourceNodes.js';
import { powerValue, usePurityOptions } from './controls.js';
import { DirectionSwitch, useDiagramDirection } from './direction.js';
import { formatNumber, formatRate, itemName, langOf, type Lang } from './format.js';
import { ItemPicker } from './ItemPicker.js';
import { PlanDiagram } from './PlanDiagram.js';
import { StepList } from './StepList.js';
import { StepPanel } from './StepPanel.js';
import { parseNumber, usePlanner, usePlannerView, type PlannerView } from './usePlanner.js';
import { useRecipes } from './useRecipes.js';

/** What the empty planner offers to try: a small chain the dataset has (left out when it does not). */
export const EXAMPLE = { item: 'Desc_IronPlateReinforced_C', rate: '5' } as const;

/** From here (Tailwind's `xl`) a selected step's machine window docks beside the steps. */
const DOCKED_QUERY = '(min-width: 1280px)';

/** What the planner needs of its world: the dataset version, the map's path for "Show on map", the toast for "Start over"'s Undo. */
export interface PlannerProps { version: string; worldId: string; toast: ToastApi }

/**
 * The planner for a dataset version: loads its recipe data and the dataset's pictures (part `icons`, for items,
 * machines and extractors), then shows the form and the plan.
 */
export function Planner({ version, worldId, toast }: PlannerProps) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.resolvedLanguage ?? i18n.language);
  const { index, error } = useRecipes(version);
  const icons = useItemIcons(version);
  if (error) return <p role="alert" className="text-conflict">{t('planner.loadFailed')}</p>;
  if (index === undefined) return <p className="text-muted">{t('common.loading')}</p>;
  if (index === null) return <p>{t('planner.noData')}</p>;
  return (
    <IconsContext.Provider value={icons}>
      <PlannerBody index={index} lang={lang} version={version} worldId={worldId} toast={toast} />
    </IconsContext.Provider>
  );
}

/**
 * The page: what you need (with the extractor settings folded away, "Start over" in its title bar) beside the answer,
 * the compact totals; under both the production steps as a diagram or a list (the view switch in their title bar), a
 * selected step's machine window beside them on a wide page. Screen readers hear the totals in one sentence when they
 * change.
 */
function PlannerBody({ index, lang, toast, ...world }: { index: RecipeIndex; lang: Lang } & PlannerProps) {
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
    // `relative`: screen-reader-only text inside is placed within the page's scroll area, not beyond it.
    <div className="relative flex flex-col gap-4">
      <PlanStatus result={shown} lang={lang} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start 2xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <Targets index={index} lang={lang} minerId={minerId} miners={miners.map(m => ({ value: m.id, label: m.name[lang] }))} limits={limits} toast={toast} />
        <div className="flex min-w-0 flex-col gap-3">
          {failed && <PlanError result={failed} index={index} lang={lang} limits={limits} />}
          {stale && <p className="text-sm text-muted">{t('planner.lastWorking')}</p>}
          {shown ? <Totals result={shown} index={index} lang={lang} defaultPurity={settings.purity} {...world} /> : !failed && <EmptyResult index={index} lang={lang} />}
        </div>
      </div>
      {shown && <Steps steps={shown.steps} index={index} lang={lang} minerId={minerId} defaultPurity={settings.purity} limits={limits} />}
    </div>
  );
}

interface StepsProps {
  steps: PlanStep[]; index: RecipeIndex; lang: Lang; minerId: string; defaultPurity: Purity; limits: ClockLimits;
}

/**
 * The plan's steps in a window, as a diagram or as a table (the switch in its title bar); a node or a row opens its
 * machine window, beside them on a wide page, else below them (scrolled into view). Closing it (×, Escape) puts the
 * focus back on the node or row. The diagram pans and zooms like a map, with its own zoom keys; it runs top to bottom
 * or left to right (`DirectionSwitch`, remembered on the device).
 */
function Steps({ steps, index, lang, minerId, defaultPurity, limits }: StepsProps) {
  const { t } = useTranslation();
  const view = usePlannerView();
  const [direction, setDirection] = useDiagramDirection('planner');
  const setView = usePlanner(s => s.setView);
  const [selected, setSelected] = useState<string | null>(null);
  const editorId = useId();
  const nodePrefix = useId();
  const nodeId = (item: string) => `${nodePrefix}${item}`;
  const step = steps.find(st => st.item === selected);
  const onSelect = (item: string) => setSelected(item === selected ? null : item);
  function closeEditor() {
    if (step) {
      const node = document.getElementById(nodeId(step.item));
      node?.focus({ preventScroll: true });
      node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    setSelected(null);
  }
  // Below 400 px only the icons show, so the title keeps its line; the words stay the radios' names.
  const viewLabel = (icon: ReactNode, text: string) => (
    <span className="inline-flex items-center"><span className="min-[400px]:hidden">{icon}</span><span className="max-[399px]:sr-only">{text}</span></span>
  );
  const views: { value: PlannerView; label: ReactNode }[] = [
    { value: 'diagram', label: viewLabel(<FlowIcon />, t('planner.viewOption.diagram')) },
    { value: 'list', label: viewLabel(<MenuIcon />, t('planner.viewOption.list')) },
  ];
  const actions = (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {view === 'diagram' && <DirectionSwitch value={direction} onChange={setDirection} />}
      <SegmentedControl label={t('planner.view')} options={views} value={view} onChange={setView} />
    </span>
  );
  return (
    <div data-fullscreen-root="" className="flex flex-col gap-4 xl:flex-row xl:items-start">
      {/* Full width like the diagram (tool pages use the whole width); the step panel docks beside it. */}
      <Window level={3} title={t('planner.steps')} actions={actions} className="min-w-0 flex-1" bodyClassName="">
        {view === 'diagram' ? (
          <PlanDiagram
            steps={steps} index={index} lang={lang} selected={step ? step.item : null} defaultPurity={defaultPurity}
            onSelect={onSelect} onDismiss={() => setSelected(null)} editorId={editorId} nodeId={nodeId} direction={direction}
          />
        ) : (
          <StepList
            steps={steps} index={index} lang={lang} selected={step ? step.item : null} defaultPurity={defaultPurity}
            onSelect={onSelect} editorId={editorId} nodeId={nodeId}
          />
        )}
      </Window>
      {step && (
        <StepEditor id={editorId} item={step.item} name={itemName(index, step.item, lang)} onClose={closeEditor}>
          <StepPanel
            key={step.item} step={step} index={index} lang={lang} minerId={minerId} limits={limits}
            onClose={closeEditor} closeLabel={t('planner.diagram.close', { item: itemName(index, step.item, lang) })} className="min-h-0"
          />
        </StepEditor>
      )}
    </div>
  );
}

/**
 * Where the selected step's machine window goes: beside the steps from 1280 px (`DOCKED_QUERY`; sticky while the page
 * scrolls, its content scrolling when taller than the screen), below them on a narrower page, where it is scrolled into
 * view when a step is selected (smoothly only where motion is welcome). Escape inside it closes it.
 */
function StepEditor({ id, item, name, onClose, children }: { id: string; item: string; name: string; onClose(): void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // Docked beside the steps it is in view already; scrolling would only move the totals away.
    if (typeof window.matchMedia === 'function' && window.matchMedia(DOCKED_QUERY).matches) return;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [item]);
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  }
  return (
    <section
      ref={ref}
      id={id}
      aria-label={t('planner.diagram.editor', { item: name })}
      onKeyDown={onKeyDown}
      className="flex scroll-mt-3 flex-col xl:sticky xl:top-0 xl:max-h-[calc(100dvh-9rem)] xl:w-[30rem] xl:shrink-0"
    >
      {children}
    </section>
  );
}

/**
 * "What do you need?": the wanted items with their rates, and the extractor settings folded away. Once something is
 * entered, "Start over" in the title bar clears the plan; its toast takes the focus to its Undo (so the keyboard and
 * screen readers reach it), and Undo puts the plan back and the focus on the first item.
 */
function Targets({ index, lang, minerId, miners, limits, toast }: {
  index: RecipeIndex; lang: Lang; minerId: string; miners: { value: string; label: string }[]; limits: ClockLimits; toast: ToastApi;
}) {
  const { t } = useTranslation();
  const targets = usePlanner(s => s.targets);
  const setTarget = usePlanner(s => s.setTarget);
  const addTarget = usePlanner(s => s.addTarget);
  const removeTarget = usePlanner(s => s.removeTarget);
  const reset = usePlanner(s => s.reset);
  const restore = usePlanner(s => s.restore);
  const list = useRef<HTMLUListElement>(null);
  const removable = targets.length > 1 || targets.some(tg => tg.item !== null);
  function startOver() {
    const before = reset();
    toast.show({
      message: t('planner.resetDone'),
      focusAction: true,
      action: {
        label: t('planner.undo'),
        run: () => {
          restore(before);
          // After the plan is back on screen (the toast and its button are gone by then).
          setTimeout(() => list.current?.querySelector('input')?.focus());
        },
      },
    });
  }
  const startOverButton = removable && <Button size="sm" variant="ghost" onClick={startOver}>{t('planner.reset')}</Button>;
  return (
    <Window level={3} title={t('planner.needs')} actions={startOverButton || undefined} bodyClassName="flex flex-col gap-3 p-3">
      <ul ref={list} className="flex flex-col gap-2">
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
  const purity = t(`planner.purityOption.${settings.purity}`);
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
        <p className="text-xs text-muted">{t('planner.purityHint', { ...PURITY_FACTOR })}</p>
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
      <p className="text-xs text-muted">{t('planner.gameModeNote')}</p>
      {example && first && (
        <Button size="sm" onClick={() => setTarget(first.key, { item: EXAMPLE.item, rate: EXAMPLE.rate })}>
          <GameIcon cls={EXAMPLE.item} px={20} />
          {t('planner.example', { item: itemName(index, EXAMPLE.item, lang), rate: formatRate(index, EXAMPLE.item, Number(EXAMPLE.rate), lang, t) })}
        </Button>
      )}
    </Window>
  );
}

/** For screen readers: the totals in one sentence ("2,550 MW, 365 buildings"), half a second after they last changed. */
function PlanStatus({ result, lang }: { result: Extract<PlanResult, { ok: true }> | null; lang: Lang }) {
  const { t } = useTranslation();
  const text = result
    ? t('planner.status', { power: powerValue(result.totals.power, lang), buildings: result.totals.machines.reduce((sum, m) => sum + m.machinesCeil, 0) })
    : '';
  const [said, setSaid] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSaid(text), 500);
    return () => clearTimeout(timer);
  }, [text]);
  return <p role="status" className="sr-only">{said}</p>;
}

/**
 * The answer, compact so the steps start high: power as the big figure (and the Power Shards of all buildings, if any
 * step needs some), beside it the raw resources with their extractors, items supplied from outside and the surplus,
 * each in as many columns as fit, every entry with the game's picture; the buildings by kind folded away under their
 * total. Exact counts are in the steps (tooltip, step panel). A resource mined on nodes links to the map, showing only
 * its nodes of the step's purity (the dataset's resource node layer).
 */
function Totals({ result, index, lang, defaultPurity, version, worldId }: {
  result: Extract<PlanResult, { ok: true }>; index: RecipeIndex; lang: Lang; defaultPurity: Purity; version: string; worldId: string;
}) {
  const { t } = useTranslation();
  const { totals } = result;
  const variable = result.steps.some(st => st.power.max - st.power.min > 1e-9);
  const pressurizer = index.data.wellPressurizer;
  const nameOf = (id: string) => index.machines.get(id)?.name[lang] ?? index.extractors.get(id)?.name[lang] ?? id;
  const buildings = totals.machines.reduce((sum, m) => sum + m.machinesCeil, 0);
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const picture = (cls: string) => <GameIcon cls={cls} px={24} placeholder />;
  const onNode = (extractor: string) => index.extractors.get(extractor)?.onNode === true;
  const nodeFile = useResourceNodeFile(version, totals.raw.some(r => onNode(r.extractor)));
  const resources = nodeFile ? nodeFile.resources.map(r => r.id) : [];
  function mapLink(item: string, extractor: string) {
    if (!onNode(extractor) || !resources.includes(item)) return null;
    const purity = result.steps.find(st => st.item === item)?.purity ?? defaultPurity;
    const show = () => {
      useNodeLayer.getState().showResource(item, resources, purity);
      useUiStore.getState().setMainView('map');
    };
    return (
      <Link to={worldPath(worldId)} onClick={show} className="inline-block py-1 -my-1 whitespace-nowrap text-accent underline-offset-2 focus-ring hover:underline">
        {t('planner.showOnMap')}
        <span className="sr-only">: {itemName(index, item, lang)} ({t(`planner.purityOption.${purity}`)})</span>
      </Link>
    );
  }
  return (
    <Window level={3} title={t('planner.totals')} bodyClassName="@container flex flex-col">
      <div className="grid gap-x-6 gap-y-3 p-3 @lg:grid-cols-[auto_minmax(0,1fr)]">
        <dl className="flex content-start items-start gap-2">
          <StatTile main label={t('planner.totalPower')} sub={variable ? t('planner.variableShort') : undefined} className="min-w-40 grow">
            <TileValue value={powerValue(totals.power, lang)} unit={t('planner.unit.mw')} />
          </StatTile>
          {totals.shards > 0 && <StatTile label={t('planner.panel.shards')} className="grow">{formatNumber(totals.shards, lang, 0)}</StatTile>}
        </dl>
        <div className="flex min-w-0 flex-col gap-3">
          <Block title={t('planner.raw')}>
            {totals.raw.length === 0 ? <p className="py-1.5 text-sm text-muted">{t('planner.none')}</p> : (
              <Columns>
                {totals.raw.map(r => {
                  const link = mapLink(r.item, r.extractor);
                  const machines = t('planner.diagram.machines', { count: r.machinesCeil, name: nameOf(r.extractor) });
                  return (
                    <StatRow
                      key={`${r.item}:${r.extractor}`} icon={picture(r.item)} label={itemName(index, r.item, lang)} value={rate(r.item, r.rate)}
                      hint={link ? <>{machines} · {link}</> : machines}
                    />
                  );
                })}
              </Columns>
            )}
          </Block>
          {totals.external.length > 0 && (
            <Block title={t('planner.externalInputs')}>
              <Columns>
                {totals.external.map(f => <StatRow key={f.item} icon={picture(f.item)} label={itemName(index, f.item, lang)} value={rate(f.item, f.rate)} />)}
              </Columns>
            </Block>
          )}
          {totals.byproducts.length > 0 && (
            <Block title={t('planner.surplus')}>
              <Columns>
                {totals.byproducts.map(f => <StatRow key={f.item} icon={picture(f.item)} label={itemName(index, f.item, lang)} value={rate(f.item, f.rate)} tone="success" />)}
              </Columns>
            </Block>
          )}
          {pressurizer && totals.pressurizers.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted">
              {totals.pressurizers.map(p => (
                <li key={p.item}>
                  {t('planner.wellNote', {
                    item: itemName(index, p.item, lang), name: pressurizer.name[lang], power: formatNumber(p.power, lang, 1),
                    clock: p.clock * 100, shards: p.shards,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Fold
        title={t('planner.buildings')} summary={formatNumber(buildings, lang, 0)}
        className="border-t border-line" summaryClassName="px-3 py-1" bodyClassName="px-3 pb-2"
      >
        <StatList>
          {totals.machines.map(m => (
            <StatRow key={m.building} icon={picture(descriptorClass(m.building))} label={nameOf(m.building)} value={formatNumber(m.machinesCeil, lang, 0)} />
          ))}
        </StatList>
      </Fold>
    </Window>
  );
}

/** A totals list in as many columns of at least 14rem as fit, so a long plan grows sideways before it grows down. */
function Columns({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-6">{children}</dl>;
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
