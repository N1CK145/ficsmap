import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FactoryDiff, FactoryTotals } from '../../../shared/factory/analysis.js';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { StatTile, TileValue } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { useImportDialog } from '../import/ImportDialog.js';
import { IconsContext, useItemIcons } from '../machineWiki/icons.js';
import { ChangesSection } from './ChangesSection.js';
import { useFactoryData, useFactoryDiff, useSnapshotAnalysis, type SnapshotAnalysis } from './data.js';
import { nearestBiome, useFactoryFormat, type FactoryFormat } from './format.js';
import { ItemsSection } from './ItemsSection.js';
import { LinesSection } from './LinesSection.js';
import { LocateContext, NONE } from './parts.js';
import { MachinesSection } from './MachinesSection.js';
import { RoutesSection } from './RoutesSection.js';
import { Timeline } from './Timeline.js';
import { useFactoryWorld, useTimeline } from './timeline.js';

/** The world page id: `/w/:id/factory`. */
export const FACTORY_PAGE = 'factory';

/** Keeps the last value that was ready, so the page does not blank out while the next snapshot loads. */
function useLastReady<T>(value: T | null | undefined): T | null | undefined {
  const last = useRef<T | null | undefined>(value);
  if (value !== undefined) last.current = value;
  return value === undefined ? last.current : value;
}

/**
 * The factory page ("Fabrik", `/w/:id/factory`): the timeline of the world's saves on top, then the answer first: the
 * figures (machines, mean productivity, stopped, part load, power capacity, with the change against the compared save),
 * the production lines with the chosen one's diagram (`?line=<id>` opens one), the changes while comparing, the inefficient items (shortages first), the machines by class with the inefficient
 * ones, and the stations and vehicles. The snapshot choice and "Show on map" live in the shared factory view (`view.ts`), so
 * the factory map follows the page and the other way round.
 */
export function FactoryPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const fmt = useFactoryFormat();
  useFactoryWorld(ctx.worldId);
  const version = ctx.me.datasetVersion;
  const icons = useItemIcons(version);
  const sel = useTimeline(ctx.worldId);
  const data = useFactoryData(version, ctx.worldId);
  const current = useSnapshotAnalysis(ctx.worldId, sel.selected?.id ?? null, data?.analysis);
  const compared = useSnapshotAnalysis(ctx.worldId, sel.compared?.id ?? null, data?.analysis);
  const shown = useLastReady(current.value);
  const diff = useFactoryDiff(compared.value, current.value);
  const locate = useMemo(() => {
    const cache = new Map<string, string | undefined>();
    return (x: number, y: number) => {
      const key = `${Math.round(x / 5000)},${Math.round(y / 5000)}`;
      if (!cache.has(key)) cache.set(key, nearestBiome(ctx.index, x, y, fmt.lang));
      return cache.get(key);
    };
  }, [ctx.index, fmt.lang]);

  if (sel.failed) return <p role="alert" className="text-conflict">{t('factory.loadFailed')}</p>;
  if (sel.list === undefined) return <p className="text-muted">{t('common.loading')}</p>;
  if (sel.ordered.length === 0) return <EmptyState ctx={ctx} />;

  const loading = current.value === undefined && !current.failed;
  return (
    <IconsContext.Provider value={icons}>
      <LocateContext.Provider value={locate}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">
          <Timeline sel={sel} fmt={fmt} loading={loading} />
          {current.failed && <p role="alert" className="text-conflict">{t('factory.snapshotFailed')}</p>}
          {data?.analysis === null && <p className="text-sm text-muted">{t('factory.noRecipes')}</p>}
          {shown && data && (
            <Body ctx={ctx} shown={shown} diff={sel.compared ? diff : null} since={sel.compared?.saveTime ?? null} fmt={fmt} data={data} />
          )}
          {!shown && !current.failed && data?.analysis !== null && <p className="text-muted">{t('common.loading')}</p>}
        </div>
      </LocateContext.Provider>
    </IconsContext.Provider>
  );
}

function Body({ ctx, shown, diff, since, fmt, data }: {
  ctx: WorldCtx; shown: SnapshotAnalysis; diff: FactoryDiff | null; since: number | null; fmt: FactoryFormat;
  data: NonNullable<ReturnType<typeof useFactoryData>>;
}) {
  const { labels } = data;
  return (
    <>
      <Kpis totals={shown.analysis.totals} diff={diff} since={since} fmt={fmt} />
      {data.analysis && <LinesSection ctx={ctx} shown={shown} data={data.analysis} labels={labels} fmt={fmt} />}
      {diff && since !== null && <ChangesSection worldId={ctx.worldId} diff={diff} since={since} labels={labels} fmt={fmt} />}
      <ItemsSection worldId={ctx.worldId} analysis={shown.analysis} labels={labels} fmt={fmt} />
      <MachinesSection worldId={ctx.worldId} analysis={shown.analysis} labels={labels} fmt={fmt} recipes={data.analysis?.recipes ?? null} />
      <RoutesSection worldId={ctx.worldId} routes={shown.routes} labels={labels} fmt={fmt} index={ctx.index} />
    </>
  );
}

/** The figures that answer "how well does the factory run": with the change against the compared save. */
function Kpis({ totals, diff, since, fmt }: { totals: FactoryTotals; diff: FactoryDiff | null; since: number | null; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const d = diff?.totals;
  const delta = (text: string | null) => (text !== null && since !== null ? t('factory.kpi.since', { delta: text, date: fmt.dateShort(since) }) : undefined);
  return (
    <dl aria-label={t('factory.kpi.label')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile
        label={t('factory.kpi.machines')}
        sub={delta(d ? fmt.intDelta(d.machines) : null)
          ?? (totals.paused > 0 ? t('factory.kpi.inefficientPaused', { count: totals.inefficient, paused: totals.paused }) : t('factory.kpi.inefficient', { count: totals.inefficient }))}
      >
        {fmt.int(totals.machines)}
      </StatTile>
      {/* The same mean as the timeline's points and tooltip (`FactoryTotals.avgProductivity`). */}
      <StatTile label={t('factory.kpi.avg')} main sub={delta(d?.avgProductivity != null ? fmt.pctDelta(d.avgProductivity) : null) ?? t('factory.kpi.avgHint')}>
        {totals.avgProductivity === null ? NONE : fmt.pct(totals.avgProductivity)}
      </StatTile>
      <StatTile label={t('factory.kpi.idle')} sub={delta(d ? fmt.intDelta(d.idle) : null) ?? t('factory.kpi.idleHint')}>
        <TileValue value={fmt.int(totals.bands.idle)} unit={pctOf(totals.bands.idle, totals.machines, fmt)} />
      </StatTile>
      <StatTile label={t('factory.kpi.throttled')} sub={delta(d ? fmt.intDelta(d.throttled) : null) ?? t('factory.kpi.throttledHint')}>
        <TileValue value={fmt.int(totals.bands.throttled)} unit={pctOf(totals.bands.throttled, totals.machines, fmt)} />
      </StatTile>
      {totals.power && (
        <StatTile
          label={t('factory.kpi.power')}
          className="max-sm:col-span-2"
          sub={delta(d?.power != null ? fmt.intDelta(Math.round(d.power)) : null) ?? t('factory.kpi.powerHint')}
        >
          <TileValue value={fmt.int(totals.power.producible)} unit="MW" />
        </StatTile>
      )}
    </dl>
  );
}

const pctOf = (n: number, total: number, fmt: FactoryFormat) => (total > 0 ? fmt.pct(n / total) : undefined);

/** No snapshot yet: what the page shows and how to fill it (owner: the import dialog; members: ask the owner). */
function EmptyState({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  return (
    <Window title={t('factory.empty.title')} className="mx-auto w-full max-w-2xl" bodyClassName="flex flex-col gap-3 p-4">
      <p>{t('factory.empty.text')}</p>
      {ctx.world.isOwner ? (
        <>
          <p className="text-sm text-muted">{t('factory.empty.owner')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => show()}>{t('factory.empty.import')}</Button>
            <Button onClick={() => show('older')}>{t('factory.empty.older')}</Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">{t('factory.empty.member', { owner: ctx.world.owner.displayName })}</p>
      )}
    </Window>
  );
}
