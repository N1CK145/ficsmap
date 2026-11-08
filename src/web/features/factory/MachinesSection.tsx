import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bandOf, filterMachines, REASONS, type FactoryAnalysis, type MachineFlow, type MachineState, type Reason } from '../../../shared/factory/analysis.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { Button } from '../../components/Button.js';
import { CloseIcon } from '../../components/icons.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { Window } from '../../components/Window.js';
import { Picture } from '../planner/pictures.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { ReasonIcon } from './icons.js';
import { MachineLine } from './ItemsSection.js';
import { BandBar, BAND_TEXT, ReasonBadge, ShowOnMap, stateKey, STATE_FILL } from './parts.js';
import { useFactoryPage, type MachineSort } from './timeline.js';

const FIRST_ROWS = 15;
/** States the filter offers (full machines are not what anyone looks for here). */
const FILTER_STATES: MachineState[] = ['idle', 'throttled', 'high', 'paused'];

const CHIP = 'inline-flex h-8 items-center gap-1.5 chamfer border px-2.5 text-sm transition-colors focus-ring max-[899px]:h-11';
const chip = (on: boolean) => `${CHIP} ${on ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-bg text-muted hover:border-edge hover:text-fg'}`;

/** Sorts machines for the list: lowest productivity, most loss, name, or highest clock speed first. */
export function sortMachines(list: readonly MachineFlow[], sort: MachineSort, name: (m: MachineFlow) => string): MachineFlow[] {
  const cmp: Record<MachineSort, (a: MachineFlow, b: MachineFlow) => number> = {
    productivity: (a, b) => a.productivity - b.productivity || b.lost - a.lost,
    lost: (a, b) => b.lost - a.lost || a.productivity - b.productivity,
    name: (a, b) => name(a).localeCompare(name(b)) || a.productivity - b.productivity,
    clock: (a, b) => b.clock - a.clock || a.productivity - b.productivity,
  };
  return [...list].sort(cmp[sort]);
}

/**
 * The list a filter shows: without a reason or state chosen the inefficient machines (of the chosen class), with one
 * every machine that has it; so a chip's count is the length of the list it gives.
 */
export function machineList(machines: readonly MachineFlow[], f: { cls: string | null; reason: Reason | null; state: MachineState | null }): MachineFlow[] {
  const base = f.reason || f.state ? machines : machines.filter(m => m.inefficient);
  return filterMachines(base, f);
}

/** Chip counts within the other filters: per reason (each machine once per reason it has) and per state. */
export function chipCounts(machines: readonly MachineFlow[], f: { cls: string | null; reason: Reason | null; state: MachineState | null }) {
  const reasons: Partial<Record<Reason, number>> = {};
  for (const m of filterMachines(machines, { cls: f.cls, state: f.state })) for (const r of m.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
  const states: Partial<Record<MachineState, number>> = {};
  for (const m of filterMachines(machines, { cls: f.cls, reason: f.reason })) states[m.state] = (states[m.state] ?? 0) + 1;
  return { reasons, states };
}

/**
 * "Machines": one card per machine class (picture, count, how many are inefficient, mean productivity, how many stand,
 * run at part load or full, are paused, and their reasons), filter chips for the reasons and states, and the list of
 * inefficient machines (see `MachineFlow.inefficient`), sortable, each with "Show on map". A card filters the list to
 * its class; the chips count within the chosen class (and the other chip), the same rule as on the map: a machine
 * counts for every reason it has.
 */
export function MachinesSection({ worldId, analysis, labels, fmt, recipes }: {
  worldId: string; analysis: FactoryAnalysis; labels: FactoryLabels; fmt: FactoryFormat; recipes: RecipeIndex | null;
}) {
  const { t } = useTranslation();
  const { cls, reason, state, sort, setFilter, clearFilters, setSort } = useFactoryPage();
  const [all, setAll] = useState(false);
  const lang = fmt.lang;
  const list = useMemo(
    () => sortMachines(machineList(analysis.machines, { cls, reason, state }), sort, m => labels.building(m.cls, lang)),
    [analysis, cls, reason, state, sort, labels, lang],
  );
  const counts = useMemo(() => chipCounts(analysis.machines, { cls, reason, state }), [analysis, cls, reason, state]);
  const shown = all ? list : list.slice(0, FIRST_ROWS);
  const filtered = cls !== null || reason !== null || state !== null;
  // Paused is offered as a state (next to the bands), not twice.
  const reasonsHere = REASONS.filter(r => r !== 'paused' && ((counts.reasons[r] ?? 0) > 0 || reason === r));
  const statesHere = FILTER_STATES.filter(b => (counts.states[b] ?? 0) > 0 || state === b);
  // The heading names every filter in use: the class, then the state or reason ("Schmelzofen · Mangel").
  const parts = [cls ? labels.building(cls, lang) : null, state ? t(stateKey(state)) : reason ? t(`factory.reason.${reason}`) : null].filter((x): x is string => x !== null);
  const heading = state || reason
    ? t('factory.machines.filtered', { filter: parts.join(' · ') })
    : cls ? t('factory.machines.inefficientOf', { filter: parts.join(' · ') }) : t('factory.machines.inefficient');
  const recipeName = (m: MachineFlow) => {
    const out = m.outputs[0];
    const item = out ? labels.item(out.item, lang) : undefined;
    const r = m.recipe ? recipes?.recipes.get(m.recipe)?.name[lang] : undefined;
    return r && item && r !== item ? `${item} · ${r}` : item ?? r;
  };

  return (
    <Window
      title={t('factory.machines.title')}
      subtitle={t('factory.machines.subtitle', { machines: analysis.totals.machines, inefficient: analysis.totals.inefficient })}
      bodyClassName="flex flex-col gap-4 p-3"
    >
      <ul aria-label={t('factory.machines.classes')} className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
        {analysis.classes.map(c => {
          const on = cls === c.cls;
          const cname = labels.building(c.cls, lang);
          return (
            <li key={c.cls}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setFilter({ cls: on ? null : c.cls })}
                className={`flex h-full w-full flex-col gap-2 chamfer border p-2.5 text-left transition-colors focus-ring ${on ? 'border-accent bg-accent/10' : 'border-line bg-bg hover:border-edge'}`}
              >
                <span className="flex items-center gap-2">
                  <Picture cls={labels.buildingPicture(c.cls)} px={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{cname}</span>
                    <span className="block text-xs text-muted tabular-nums max-[899px]:text-sm">
                      {t('factory.machines.count', { count: c.count })}
                      {c.inefficient > 0 && <span className="text-fg"> · {t('factory.machines.inefficientCount', { count: c.inefficient })}</span>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={`block font-display text-xl leading-none font-semibold tabular-nums ${BAND_TEXT[bandOf(c.avgProductivity)]}`}>{fmt.pct(c.avgProductivity)}</span>
                    <span className="block text-xs text-muted">{t('factory.machines.avg')}</span>
                  </span>
                </span>
                <BandBar bands={c.bands} paused={c.paused} />
                {Object.keys(c.reasons).length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {REASONS.filter(r => c.reasons[r]).map(r => <ReasonBadge key={r} reason={r} count={c.reasons[r]} />)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="factory-inefficient" className="flex flex-col gap-2">
        <SectionHeading as="h3" id="factory-inefficient" end={t('factory.machines.listCount', { count: list.length })}>
          {heading}
        </SectionHeading>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('factory.machines.filters')}>
          {reasonsHere.map(r => (
            <button key={r} type="button" aria-pressed={reason === r} className={chip(reason === r)} onClick={() => setFilter({ reason: reason === r ? null : r })} title={t(`factory.reasonHint.${r}`)}>
              <ReasonIcon reason={r} />
              {t(`factory.reason.${r}`)}
              <span className="tabular-nums text-muted">{counts.reasons[r] ?? 0}</span>
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          {statesHere.map(b => (
            <button key={b} type="button" aria-pressed={state === b} className={chip(state === b)} onClick={() => setFilter({ state: state === b ? null : b })}>
              <span aria-hidden="true" className={`inline-block size-2 ${STATE_FILL[b]}`} />
              {t(stateKey(b))}
              <span className="tabular-nums text-muted">{counts.states[b] ?? 0}</span>
            </button>
          ))}
          {cls !== null && (
            <button type="button" className={chip(true)} onClick={() => setFilter({ cls: null })}>
              {labels.building(cls, lang)}
              <CloseIcon size={12} />
              <span className="sr-only">{t('factory.machines.removeClass')}</span>
            </button>
          )}
          {filtered && <Button size="sm" variant="ghost" onClick={clearFilters}>{t('factory.machines.clear')}</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl<MachineSort>
            label={t('factory.machines.sort')}
            value={sort}
            onChange={setSort}
            options={(['productivity', 'lost', 'name', 'clock'] as const).map(v => ({ value: v, label: t(`factory.machines.sortBy.${v}`) }))}
          />
          <ShowOnMap worldId={worldId} ids={list.map(m => m.id)} label={t('factory.machines.listLabel', { count: list.length })} />
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted">{filtered ? t('factory.machines.noMatch') : t('factory.machines.allFine')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {shown.map(m => (
              <MachineLine
                key={m.id} worldId={worldId} m={m} labels={labels} fmt={fmt} recipeName={recipeName(m)}
                lost={m.outputs[0] ? m.outputs[0].lost : null} fluid={m.outputs[0] ? labels.isFluid(m.outputs[0].item) : false}
              />
            ))}
          </ul>
        )}
        {list.length > FIRST_ROWS && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? t('factory.showFewer') : t('factory.showAll', { count: list.length })}
            </Button>
          </div>
        )}
      </section>
    </Window>
  );
}
