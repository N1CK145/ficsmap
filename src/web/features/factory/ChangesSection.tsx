import { useTranslation } from 'react-i18next';
import { bandOf, type FactoryDiff, type MachineChange } from '../../../shared/factory/analysis.js';
import { Fold } from '../../components/Fold.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { Window } from '../../components/Window.js';
import { Picture } from '../planner/pictures.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { BAND_TEXT, ShowOnMap } from './parts.js';

const TOP = 8;

/**
 * "Changes" while comparing: buildings built and torn down per class, the items whose loss changed most, and the
 * machines that got worse or better (by at least 5 points of productivity), between the compared and the selected
 * snapshot.
 */
export function ChangesSection({ worldId, diff, since, labels, fmt }: { worldId: string; diff: FactoryDiff; since: number; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const lang = fmt.lang;
  const classes = diff.classes;
  return (
    <Window
      title={t('factory.changes.title')}
      subtitle={t('factory.changes.subtitle', { date: fmt.dateTime(since), added: diff.added.length, removed: diff.removed.length })}
      bodyClassName="grid gap-x-6 gap-y-4 p-3 lg:grid-cols-2"
    >
      <section aria-labelledby="factory-built" className="flex min-w-0 flex-col gap-1">
        <SectionHeading as="h3" id="factory-built" end={diff.added.length > 0 ? <ShowOnMap worldId={worldId} ids={diff.added} label={t('factory.changes.newBuildings')} /> : undefined}>
          {t('factory.changes.built')}
        </SectionHeading>
        {classes.length === 0 ? <p className="text-sm text-muted">{t('factory.changes.noBuildings')}</p> : (
          <>
            <ClassList list={classes.slice(0, TOP)} labels={labels} fmt={fmt} />
            {classes.length > TOP && (
              <Fold title={t('factory.changes.moreClasses', { count: classes.length - TOP })} className="border-t border-line">
                <ClassList list={classes.slice(TOP)} labels={labels} fmt={fmt} />
              </Fold>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="factory-item-changes" className="flex min-w-0 flex-col gap-1">
        <SectionHeading as="h3" id="factory-item-changes">{t('factory.changes.items')}</SectionHeading>
        {diff.items.length === 0 ? <p className="text-sm text-muted">{t('factory.changes.noItems')}</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {diff.items.slice(0, TOP).map(i => {
              const fluid = labels.isFluid(i.item);
              const worse = i.delta > 0;
              return (
                <li key={i.item} className="flex items-center gap-2 py-1 text-sm">
                  <Picture cls={i.item} px={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{labels.item(i.item, lang)}</span>
                    <span className="block text-xs text-muted tabular-nums max-[899px]:text-sm">
                      {t('factory.changes.lossFromTo', { from: fmt.num1(i.lostBefore), to: fmt.rate(i.lostAfter, fluid) })}
                    </span>
                  </span>
                  <span className={`font-display font-semibold whitespace-nowrap tabular-nums ${worse ? 'text-conflict' : 'text-free'}`}>
                    {t(worse ? 'factory.changes.moreLoss' : 'factory.changes.lessLoss', { value: fmt.rate(Math.abs(i.delta), fluid) })}
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
      <SectionHeading as="h3" id={id} end={list.length > 0 ? <ShowOnMap worldId={worldId} ids={list.map(c => c.id)} label={title} /> : undefined}>{title}</SectionHeading>
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
