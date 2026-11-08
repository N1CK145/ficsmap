import { useTranslation } from 'react-i18next';
import type { BuildingCategory } from '../../../shared/buildings.js';
import { bandOf, type ClassChange, type FactoryDiff, type MachineChange } from '../../../shared/factory/analysis.js';
import { Fold } from '../../components/Fold.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { Window } from '../../components/Window.js';
import { Picture } from '../planner/pictures.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { BAND_TEXT, ShowOnMap } from './parts.js';

const TOP = 8;
/** Heading rows the same height, with or without an action at their end. */
const HEADING = 'min-h-8 max-[899px]:min-h-11';

/** The order of the built and torn down list: machines first, then the other buildings. */
const CATEGORY_ORDER: BuildingCategory[] = ['production', 'extraction', 'power-gen', 'power-storage', 'storage', 'transport', 'special', 'sign', 'other'];
/** Belts, lifts, splitters, mergers, supports, pipe junctions, poles, hypertubes, passthroughs: one summary line. */
const LOGISTICS: ReadonlySet<BuildingCategory> = new Set(['logistics-belt', 'logistics-pipe', 'power-pole', 'hypertube', 'structure']);

/** Built and torn down per class split into the buildings (by category, machines first) and the logistics parts. */
export function splitClassChanges(classes: readonly ClassChange[], category: (cls: string) => BuildingCategory | undefined): { main: ClassChange[]; logistics: ClassChange[] } {
  const rank = (cls: string) => {
    const i = CATEGORY_ORDER.indexOf(category(cls) ?? 'other');
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const main: ClassChange[] = [];
  const logistics: ClassChange[] = [];
  for (const c of classes) (LOGISTICS.has(category(c.cls) ?? 'other') ? logistics : main).push(c);
  main.sort((a, b) => rank(a.cls) - rank(b.cls) || (b.added + b.removed) - (a.added + a.removed) || a.cls.localeCompare(b.cls));
  return { main, logistics };
}

/**
 * "Changes" while comparing: buildings built and torn down per class (machines first, the logistics parts folded into
 * one line), the items whose loss changed most ("55.7 → 555.2/min", the arrow red for more loss, green for less),
 * and the machines that got worse or better (by at least 5 points of productivity), between the compared and the
 * selected snapshot.
 */
export function ChangesSection({ worldId, diff, since, labels, fmt }: { worldId: string; diff: FactoryDiff; since: number; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const lang = fmt.lang;
  const { main: classes, logistics } = splitClassChanges(diff.classes, labels.category);
  const logisticsAdded = logistics.reduce((n, c) => n + c.added, 0);
  const logisticsRemoved = logistics.reduce((n, c) => n + c.removed, 0);
  return (
    <Window
      title={t('factory.changes.title')}
      subtitle={t('factory.changes.subtitle', { date: fmt.dateTime(since), added: diff.added.length, removed: diff.removed.length })}
      bodyClassName="grid gap-x-6 gap-y-4 p-3 lg:grid-cols-2"
    >
      <section aria-labelledby="factory-built" className="flex min-w-0 flex-col gap-1">
        <SectionHeading as="h3" id="factory-built" className={HEADING} end={diff.added.length > 0 ? <ShowOnMap worldId={worldId} ids={diff.added} label={t('factory.changes.newBuildings')} /> : undefined}>
          {t('factory.changes.built')}
        </SectionHeading>
        {diff.classes.length === 0 ? <p className="text-sm text-muted">{t('factory.changes.noBuildings')}</p> : (
          <>
            <ClassList list={classes.slice(0, TOP)} labels={labels} fmt={fmt} />
            {classes.length > TOP && (
              <Fold title={t('factory.changes.moreClasses', { count: classes.length - TOP })} className="border-t border-line">
                <ClassList list={classes.slice(TOP)} labels={labels} fmt={fmt} />
              </Fold>
            )}
            {logistics.length > 0 && (
              <Fold
                title={t('factory.changes.logistics')}
                summary={(
                  <span title={t('factory.changes.logisticsHint')}>
                    {logisticsAdded > 0 && <span className="font-display font-semibold text-free">{t('factory.changes.added', { count: logisticsAdded })}</span>}
                    {logisticsAdded > 0 && logisticsRemoved > 0 && ' '}
                    {logisticsRemoved > 0 && <span className="font-display font-semibold text-conflict">{t('factory.changes.removed', { count: logisticsRemoved })}</span>}
                    {' · '}{t('factory.changes.logisticsCount', { count: logistics.length })}
                  </span>
                )}
                className="border-t border-line"
              >
                <ClassList list={logistics} labels={labels} fmt={fmt} />
              </Fold>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="factory-item-changes" className="flex min-w-0 flex-col gap-1">
        <SectionHeading as="h3" id="factory-item-changes" className={HEADING}>{t('factory.changes.items')}</SectionHeading>
        {diff.items.length === 0 ? <p className="text-sm text-muted">{t('factory.changes.noItems')}</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {diff.items.slice(0, TOP).map(i => {
              const fluid = labels.isFluid(i.item);
              const worse = i.delta > 0;
              return (
                <li key={i.item} className="flex items-center gap-2 py-1 text-sm">
                  <Picture cls={i.item} px={20} />
                  <span className="min-w-0 flex-1 truncate">{labels.item(i.item, lang)}</span>
                  <span className="whitespace-nowrap tabular-nums">
                    <span className="text-muted">{fmt.num1(i.lostBefore)}</span>
                    <span aria-hidden="true" className={`mx-1 font-semibold ${worse ? 'text-conflict' : 'text-free'}`}>→</span>
                    <span className="sr-only">{t('factory.changes.to')}</span>
                    <span className={`font-display font-semibold ${worse ? 'text-conflict' : 'text-free'}`}>{fmt.rate(i.lostAfter, fluid)}</span>
                    <span className="sr-only"> ({t(worse ? 'factory.changes.moreLoss' : 'factory.changes.lessLoss')})</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MachineChanges worldId={worldId} id="factory-worse" title={t('factory.changes.worse', { count: diff.worse.length })} list={diff.worse} labels={labels} fmt={fmt} />
      <MachineChanges worldId={worldId} id="factory-better" title={t('factory.changes.better', { count: diff.better.length })} list={diff.better} labels={labels} fmt={fmt} />
    </Window>
  );
}

function ClassList({ list, labels, fmt }: { list: FactoryDiff['classes']; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col divide-y divide-line">
      {list.map(c => (
        <li key={c.cls} className="flex items-center gap-2 py-1.5 text-sm">
          <Picture cls={labels.buildingPicture(c.cls)} px={20} />
          <span className="min-w-0 flex-1 truncate">{labels.building(c.cls, fmt.lang)}</span>
          {c.added > 0 && <span className="font-display font-semibold text-free tabular-nums" title={t('factory.changes.addedHint')}>{t('factory.changes.added', { count: c.added })}</span>}
          {c.removed > 0 && <span className="font-display font-semibold text-conflict tabular-nums" title={t('factory.changes.removedHint')}>{t('factory.changes.removed', { count: c.removed })}</span>}
        </li>
      ))}
    </ul>
  );
}

function MachineChanges({ worldId, id, title, list, labels, fmt }: { worldId: string; id: string; title: string; list: MachineChange[]; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <SectionHeading as="h3" id={id} className={HEADING} end={list.length > 0 ? <ShowOnMap worldId={worldId} ids={list.map(c => c.id)} label={title} /> : undefined}>{title}</SectionHeading>
      {list.length === 0 ? <p className="text-sm text-muted">{t('factory.changes.noMachines')}</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {list.slice(0, TOP).map(c => {
            const name = labels.building(c.cls, fmt.lang);
            const item = c.machine.outputs[0]?.item;
            return (
              <li key={c.id} className="flex items-center gap-2 py-1 text-sm">
                <Picture cls={labels.buildingPicture(c.cls)} px={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  {item && <span className="block truncate text-xs text-muted max-[899px]:text-sm">{labels.item(item, fmt.lang)}</span>}
                </span>
                <span className="tabular-nums">
                  <span className={BAND_TEXT[bandOf(c.before)]}>{fmt.pct(c.before)}</span>
                  <span aria-hidden="true" className="mx-1 text-muted">→</span>
                  <span className="sr-only">{t('factory.changes.to')}</span>
                  <span className={`font-semibold ${BAND_TEXT[bandOf(c.after)]}`}>{fmt.pct(c.after)}</span>
                </span>
                <ShowOnMap worldId={worldId} ids={[c.id]} label={name} compact />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
