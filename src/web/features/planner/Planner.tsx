import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { choiceKey, choiceOptions, clockLimits, defaultChoice, MAX_SHARDS, parseChoiceKey, plan, PURITY_FACTOR, type Choice, type ClockLimits, type Flow, type PlanResult, type PlanStep, type Purity, type StepSettings } from '../../../shared/planner.js';
import { miners as minersOf, type RecipeIndex } from '../../../shared/recipes.js';
import { Button } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { formatNumber, formatRate, itemName, langOf, type Lang } from './format.js';
import { ItemPicker } from './ItemPicker.js';
import { parseNumber, usePlanner } from './usePlanner.js';
import { useRecipes } from './useRecipes.js';

/** The planner for a dataset version: loads its recipe data, then shows the form and the plan. */
export function Planner({ version }: { version: string }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.resolvedLanguage ?? i18n.language);
  const { index, error } = useRecipes(version);
  if (error) return <p role="alert" className="text-conflict">{t('planner.loadFailed')}</p>;
  if (index === undefined) return <p className="text-muted">{t('common.loading')}</p>;
  if (index === null) return <p>{t('planner.noData')}</p>;
  return <PlannerBody index={index} lang={lang} />;
}

const inputClass = 'h-10 rounded border border-line bg-bg px-3 text-fg focus-ring';

function PlannerBody({ index, lang }: { index: RecipeIndex; lang: Lang }) {
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

  return (
    <div className="flex flex-col gap-5">
      <Targets index={index} lang={lang} />
      <ExtractorSettings minerId={minerId} miners={miners.map(m => ({ value: m.id, label: m.name[lang] }))} limits={limits} />
      {result && !result.ok && <PlanError result={result} index={index} lang={lang} limits={limits} />}
      {result?.ok && (
        <>
          <section aria-labelledby="planner-steps">
            <h3 id="planner-steps" className="mb-2 font-display text-lg font-semibold">{t('planner.steps')}</h3>
            <ol className="flex flex-col gap-2">
              {result.steps.map(st => <StepRow key={st.item} step={st} index={index} lang={lang} minerId={minerId} defaultClock={settings.clock} />)}
            </ol>
          </section>
          <Totals result={result} index={index} lang={lang} />
        </>
      )}
    </div>
  );
}

function Targets({ index, lang }: { index: RecipeIndex; lang: Lang }) {
  const { t } = useTranslation();
  const targets = usePlanner(s => s.targets);
  const setTarget = usePlanner(s => s.setTarget);
  const addTarget = usePlanner(s => s.addTarget);
  const removeTarget = usePlanner(s => s.removeTarget);
  const reset = usePlanner(s => s.reset);
  return (
    <section aria-labelledby="planner-needs">
      <h3 id="planner-needs" className="mb-2 font-display text-lg font-semibold">{t('planner.needs')}</h3>
      <ul className="flex flex-col gap-2">
        {targets.map((tg, i) => {
          const name = tg.item ? itemName(index, tg.item, lang) : t('planner.itemN', { n: i + 1 });
          const fluid = tg.item ? index.items.get(tg.item)?.form !== 'solid' : false;
          return (
            <li key={tg.key} className="flex flex-wrap items-center gap-2">
              <ItemPicker index={index} lang={lang} value={tg.item} label={t('planner.itemN', { n: i + 1 })} onChange={item => setTarget(tg.key, { item })} />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t('planner.rateFor', { item: name })}
                  value={tg.rate}
                  onChange={e => setTarget(tg.key, { rate: e.target.value })}
                  className={`${inputClass} w-24 text-right`}
                />
                <span className="w-16 text-sm text-muted">{fluid ? t('planner.unit.fluidPerMin') : t('planner.unit.perMin')}</span>
                <IconButton aria-label={t('planner.remove', { item: name })} size="md" onClick={() => removeTarget(tg.key)}>
                  <span aria-hidden="true">×</span>
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={addTarget}>{t('planner.add')}</Button>
        <Button size="sm" variant="ghost" onClick={reset}>{t('planner.reset')}</Button>
      </div>
    </section>
  );
}

function ExtractorSettings({ minerId, miners, limits }: { minerId: string; miners: { value: string; label: string }[]; limits: ClockLimits }) {
  const { t } = useTranslation();
  const settings = usePlanner(s => s.settings);
  const setSettings = usePlanner(s => s.setSettings);
  const clockId = useId();
  const clockHint = useId();
  const purityHint = useId();
  const purities = usePurityOptions();
  return (
    <fieldset className="flex flex-col gap-3 rounded border border-line p-3">
      <legend className="px-1 font-display text-lg font-semibold">{t('planner.extractors')}</legend>
      {miners.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t('planner.miner')}</span>
          <SegmentedControl label={t('planner.miner')} options={miners} value={minerId} onChange={miner => setSettings({ miner })} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{t('planner.purity')}</span>
        <SegmentedControl<Purity> label={t('planner.purity')} options={purities} value={settings.purity} onChange={purity => setSettings({ purity })} />
      </div>
      <p id={purityHint} className="text-sm text-muted">{t('planner.purityHint')}</p>
      <label htmlFor={clockId} className="flex items-center gap-2 text-sm">
        {t('planner.clock')}
        <input id={clockId} type="text" inputMode="decimal" aria-describedby={clockHint} value={settings.clock} onChange={e => setSettings({ clock: e.target.value })} className={`${inputClass} w-20 text-right`} />
      </label>
      <p id={clockHint} className="text-sm text-muted">{t('planner.clockHint', { ...percentRange(limits), per: limits.perShard * 100, slots: MAX_SHARDS })}</p>
    </fieldset>
  );
}

/** The clock speed range in percent, for messages. */
const percentRange = (limits: ClockLimits) => ({ min: limits.min * 100, max: limits.max * 100 });

/** Impure / Normal / Pure with their factor, for a SegmentedControl or a select. */
function usePurityOptions(): { value: Purity; label: string }[] {
  const { t } = useTranslation();
  return (Object.keys(PURITY_FACTOR) as Purity[]).map(p => ({ value: p, label: t(`planner.purityOption.${p}`, { factor: PURITY_FACTOR[p] }) }));
}

function PlanError({ result, index, lang, limits }: { result: Extract<PlanResult, { ok: false }>; index: RecipeIndex; lang: Lang; limits: ClockLimits }) {
  const { t } = useTranslation();
  let text: string;
  if (result.error === 'cycle') text = t('planner.error.cycle', { items: result.items.map(i => itemName(index, i, lang)).join(', ') });
  else if (result.error === 'invalid-settings') text = t('planner.error.invalidSettings', percentRange(limits));
  else if (result.error === 'invalid-clock') text = t('planner.error.invalidClock', { item: itemName(index, result.item, lang), ...percentRange(limits) });
  else if (result.error === 'unknown-item') text = t('planner.error.unknownItem', { item: result.item });
  else text = t('planner.error.noTargets');
  return <p role="alert" className="rounded border border-conflict p-3 text-sm">{text}</p>;
}

function useChoiceLabel(index: RecipeIndex, lang: Lang, item: string, minerId: string) {
  const { t } = useTranslation();
  return (c: Choice): string => {
    if (c.kind === 'external') return t('planner.option.external');
    if (c.kind === 'extract') {
      if (!c.extractor) return t('planner.option.miner', { name: index.extractors.get(minerId)?.name[lang] ?? '' });
      return index.extractors.get(c.extractor)?.name[lang] ?? c.extractor;
    }
    const r = index.recipes.get(c.recipe);
    if (!r) return c.recipe;
    const args = { recipe: r.name[lang], machine: index.machines.get(r.machine)?.name[lang] ?? r.machine };
    return r.products[0]?.item === item ? t('planner.option.recipe', args) : t('planner.option.byproduct', args);
  };
}

function flows(index: RecipeIndex, list: readonly Flow[], lang: Lang, t: ReturnType<typeof useTranslation>['t']): string {
  return list.map(f => `${formatRate(index, f.item, f.rate, lang, t)} ${itemName(index, f.item, lang)}`).join(', ');
}

function StepRow({ step, index, lang, minerId, defaultClock }: { step: PlanStep; index: RecipeIndex; lang: Lang; minerId: string; defaultClock: string }) {
  const { t } = useTranslation();
  const setChoice = usePlanner(s => s.setChoice);
  const setStep = usePlanner(s => s.setStep);
  const input = usePlanner(s => s.steps[step.item]);
  const purities = usePurityOptions();
  const selectId = useId();
  const clockId = useId();
  const purityId = useId();
  const name = itemName(index, step.item, lang);
  const label = useChoiceLabel(index, lang, step.item, minerId);
  const current = choiceKey(step.choice);
  const offered = choiceOptions(index, step.item);
  const options = offered.some(o => choiceKey(o) === current) ? offered : [step.choice, ...offered];
  const building = step.recipe ? index.machines.get(step.recipe.machine)?.name[lang] : step.extractor?.name[lang];
  // A resource well step's clock speed and shards are its pressurizer's.
  const pressurizer = step.pressurizer ? index.data.wellPressurizer?.name[lang] : undefined;
  const whole = Math.abs(step.machines - step.machinesCeil) < 1e-6;

  function onChoose(key: string) {
    const c = parseChoiceKey(key);
    if (!c) return;
    setChoice(step.item, choiceKey(c) === choiceKey(defaultChoice(index, step.item)) ? null : c);
  }

  return (
    <li className="rounded border border-line bg-bg p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="font-semibold">
          {name}
          {step.cycle && <span title={t('planner.cycleHint')} className="ml-2 rounded border border-accent px-1.5 text-xs font-medium text-accent">{t('planner.cycle')}</span>}
        </h4>
        <span className="tabular-nums">{formatRate(index, step.item, step.rate, lang, t)}</span>
      </div>
      {step.targetRate > 0 && step.targetRate < step.rate - 1e-9 && (
        <p className="text-sm text-muted">{t('planner.forYou', { value: formatRate(index, step.item, step.targetRate, lang, t) })}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-sm text-muted">{t('planner.howMade')}</label>
        <select
          id={selectId}
          value={current}
          onChange={e => onChoose(e.target.value)}
          className="h-10 min-w-0 max-w-full flex-1 rounded border border-line bg-panel px-2 text-sm text-fg focus-ring"
        >
          {options.map(o => <option key={choiceKey(o)} value={choiceKey(o)}>{label(o)}</option>)}
        </select>
      </div>
      {step.choice.kind !== 'external' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor={clockId} className="flex items-center gap-2 text-sm text-muted">
            {t('planner.stepClock')}
            <input
              id={clockId}
              type="text"
              inputMode="decimal"
              value={input?.clock ?? ''}
              placeholder={step.extractor ? defaultClock : '100'}
              onChange={e => setStep(step.item, { clock: e.target.value })}
              className={`${inputClass} w-20 text-right`}
            />
          </label>
          {step.purity && (
            <label htmlFor={purityId} className="flex items-center gap-2 text-sm text-muted">
              {t('planner.purity')}
              <select
                id={purityId}
                value={step.purity}
                onChange={e => setStep(step.item, { purity: e.target.value as Purity })}
                className="h-10 rounded border border-line bg-panel px-2 text-sm text-fg focus-ring"
              >
                {purities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
          )}
          {step.shards > 0 && (
            <span className="text-sm text-muted">
              {pressurizer ? t('planner.shardsPressurizer', { count: step.shards, name: pressurizer }) : t('planner.shards', { count: step.shards })}
            </span>
          )}
        </div>
      )}
      {pressurizer && <p className="mt-2 text-sm text-muted">{t('planner.wellClock', { name: pressurizer })}</p>}
      {step.fromByproducts > 1e-9 && (
        <p className="mt-2 text-sm text-muted">{t('planner.fromByproducts', { value: formatRate(index, step.item, step.fromByproducts, lang, t) })}</p>
      )}
      {step.auto === 'loop' && <p className="mt-2 text-sm text-muted">{t('planner.autoLoop')}</p>}
      {step.choice.kind === 'external'
        ? <p className="mt-2 text-sm text-muted">{t('planner.external')}</p>
        : step.machines < 1e-9 ? <p className="mt-2 text-sm text-muted">{t('planner.noMachines')}</p> : (
          <p className="mt-2 text-sm">
            <span className="font-medium">{t('planner.machines', { count: step.machinesCeil, name: building ?? '' })}</span>
            {!whole && <span className="text-muted"> ({t('planner.exact', { value: formatNumber(step.machines, lang, 3) })})</span>}
            <span className="text-muted"> · {powerText(step.power, lang, t)}</span>
          </p>
        )}
      {step.inputs.length > 0 && <p className="text-sm"><span className="text-muted">{t('planner.inputs')}:</span> {flows(index, step.inputs, lang, t)}</p>}
      {step.byproducts.length > 0 && <p className="text-sm"><span className="text-muted">{t('planner.byproducts')}:</span> {flows(index, step.byproducts, lang, t)}</p>}
    </li>
  );
}

function powerText(p: { min: number; max: number }, lang: Lang, t: ReturnType<typeof useTranslation>['t']): string {
  return Math.abs(p.max - p.min) < 1e-9
    ? t('planner.power', { value: formatNumber(p.min, lang, 1) })
    : t('planner.powerRange', { min: formatNumber(p.min, lang, 1), max: formatNumber(p.max, lang, 1) });
}

function Totals({ result, index, lang }: { result: Extract<PlanResult, { ok: true }>; index: RecipeIndex; lang: Lang }) {
  const { t } = useTranslation();
  const { totals } = result;
  const variable = result.steps.some(st => st.power.max - st.power.min > 1e-9);
  const pressurizer = index.data.wellPressurizer;
  const buildingName = (id: string) => index.machines.get(id)?.name[lang] ?? index.extractors.get(id)?.name[lang] ?? id;
  const exactNote = (ceil: number, exact: number) =>
    (Math.abs(ceil - exact) > 1e-6 ? ` (${t('planner.exact', { value: formatNumber(exact, lang, 3) })})` : '');
  const count = (ceil: number, exact: number) => `${formatNumber(ceil, lang, 0)}${exactNote(ceil, exact)}`;
  const row = 'flex flex-wrap justify-between gap-x-3 py-1';
  return (
    <section aria-labelledby="planner-totals" className="flex flex-col gap-3">
      <h3 id="planner-totals" className="font-display text-lg font-semibold">{t('planner.totals')}</h3>
      <div>
        <h4 className="font-semibold">{t('planner.raw')}</h4>
        {totals.raw.length === 0 ? <p className="text-sm text-muted">{t('planner.none')}</p> : (
          <ul className="divide-y divide-line text-sm">
            {totals.raw.map(r => (
              <li key={`${r.item}:${r.extractor}`} className={row}>
                <span>{itemName(index, r.item, lang)} <span className="text-muted">· {t('planner.machines', { count: r.machinesCeil, name: buildingName(r.extractor) })}{exactNote(r.machinesCeil, r.machines)}</span></span>
                <span className="tabular-nums">{formatRate(index, r.item, r.rate, lang, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {totals.external.length > 0 && (
        <div>
          <h4 className="font-semibold">{t('planner.externalInputs')}</h4>
          <ul className="divide-y divide-line text-sm">
            {totals.external.map(f => (
              <li key={f.item} className={row}><span>{itemName(index, f.item, lang)}</span><span className="tabular-nums">{formatRate(index, f.item, f.rate, lang, t)}</span></li>
            ))}
          </ul>
        </div>
      )}
      {totals.byproducts.length > 0 && (
        <div>
          <h4 className="font-semibold">{t('planner.surplus')}</h4>
          <ul className="divide-y divide-line text-sm">
            {totals.byproducts.map(f => (
              <li key={f.item} className={row}><span>{itemName(index, f.item, lang)}</span><span className="tabular-nums">{formatRate(index, f.item, f.rate, lang, t)}</span></li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="font-semibold">{t('planner.buildings')}</h4>
        <ul className="divide-y divide-line text-sm">
          {totals.machines.map(m => (
            <li key={m.building} className={row}><span>{buildingName(m.building)}</span><span className="tabular-nums">{count(m.machinesCeil, m.machines)}</span></li>
          ))}
        </ul>
      </div>
      <p className="text-sm">
        <span className="font-semibold">{t('planner.totalPower')}:</span> <span className="tabular-nums">{powerText(totals.power, lang, t)}</span>
      </p>
      <ul className="list-disc pl-5 text-sm text-muted">
        <li>{t('planner.roundedNote')}</li>
        {variable && <li>{t('planner.variableNote')}</li>}
        {pressurizer && totals.pressurizers.map(p => (
          <li key={p.item}>
            {t('planner.wellNote', {
              item: itemName(index, p.item, lang), name: pressurizer.name[lang], power: formatNumber(p.power, lang, 1),
              clock: p.clock * 100, shards: p.shards,
            })}
          </li>
        ))}
        <li>{t('planner.gameModeNote')}</li>
      </ul>
    </section>
  );
}
