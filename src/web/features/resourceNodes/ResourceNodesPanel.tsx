import { useId, useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { countNodes, isRandomized, OCCUPANCIES, PURITIES, summarizeExtractors } from '../../../shared/resourceNodes.js';
import { IconsContext, useItemIcons } from '../machineWiki/icons.js';
import { useRecipes } from '../planner/useRecipes.js';
import { useMe } from '../worlds/queries.js';
import { ShardPips } from './Extractors.js';
import { useNodeSettingsText } from './nodeSettings.js';
import { PurityDot, ResourceIcon } from './PurityPips.js';
import { useRateTexts } from './rates.js';
import { PURITY_TEXT, resourceToken, sortResources, useResourceLabels } from './resourceStyle.js';
import { useNodeFilter, useNodeLayer, useWorldNodes } from './useResourceNodes.js';

const ROW = 'flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm select-none focus-ring hover:bg-bg';

/**
 * The Resource nodes panel: the layer switch, the filters by resource (Alt-click: only this one, each with the
 * resource's picture) and by purity (in its colour, with the miners' rates on such a node) with their counts, and
 * what the last save import changed. With extractors from a save import also a filter for nodes with or without one,
 * and how many of each building stand on nodes with how many Power Shards.
 */
export function ResourceNodesPanel({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const version = useMe().data?.datasetVersion;
  const data = useWorldNodes(version ?? '', worldId, version !== undefined);
  const icons = useItemIcons(version ?? '', !!data);
  const rates = useRateTexts(useRecipes(version ?? '', !!data).index);
  const filter = useNodeFilter(data?.extractors);
  const visible = useNodeLayer(s => s.visible);
  const { toggle, toggleResource, showOnlyResource, setAllResources, togglePurity, setOccupancy } = useNodeLayer.getState();
  const labelOf = useResourceLabels(data?.file);
  const settingsText = useNodeSettingsText();
  const resLabel = useId();
  const purityLabel = useId();
  const occupancyLabel = useId();
  const extractorsLabel = useId();

  const resources = useMemo(() => (data ? sortResources(data.file.resources.map(r => r.id)) : []), [data]);
  const counts = useMemo(() => (data ? countNodes(data.nodes, filter) : null), [data, filter]);
  const summary = useMemo(() => (data && data.extractors.size > 0 ? summarizeExtractors(data.extractors) : null), [data]);
  if (data === null) return <p className="text-sm text-muted">{t('resourceNodes.none')}</p>;
  if (data === undefined || !counts) return null;
  const changed = data.nodes.filter(n => n.original).length;
  const settings = data.overrides?.settings ?? null;

  const onResource = (e: MouseEvent, id: string) => (e.altKey ? showOnlyResource(id, resources) : toggleResource(id));
  return (
    <div className="flex flex-col gap-3">
      <button type="button" aria-pressed={visible} onClick={toggle} className={`${ROW} justify-between border border-line`}>
        <span>{t('resourceNodes.show')}</span>
        <span className={visible ? 'text-accent' : 'text-muted'}>{t(visible ? 'resourceNodes.on' : 'resourceNodes.off')}</span>
      </button>

      {changed > 0 && <p className="text-xs text-muted">{t('resourceNodes.changedNote', { count: changed })}</p>}
      {changed === 0 && isRandomized(settings) && (
        <p role="note" className="rounded border border-conflict px-2 py-1 text-xs">
          {t('resourceNodes.randomizedNote', { mode: settingsText(settings) })}
        </p>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
          <span id={resLabel}>{t('resourceNodes.resource')}</span>
          <span className="flex gap-2">
            <button type="button" className="rounded px-1 focus-ring hover:text-fg" onClick={() => setAllResources(true, resources)}>{t('resourceNodes.all')}</button>
            <button type="button" className="rounded px-1 focus-ring hover:text-fg" onClick={() => setAllResources(false, resources)}>{t('resourceNodes.noneShown')}</button>
          </span>
        </div>
        <IconsContext.Provider value={icons}>
          <ul aria-labelledby={resLabel} className="flex flex-col">
            {resources.map(id => {
              const on = !filter.hiddenResources.has(id);
              return (
                <li key={id}>
                  <button type="button" aria-pressed={on} title={t('resourceNodes.resourceHint')} onClick={e => onResource(e, id)} className={`${ROW} ${on ? 'text-fg' : 'text-muted'}`}>
                    <span className={`inline-flex ${on ? '' : 'opacity-40'}`}><ResourceIcon id={id} token={resourceToken(id)} /></span>
                    <span className="min-w-0 flex-1 truncate">{labelOf(id).name}</span>
                    <span className="shrink-0 font-display tabular-nums">{t('resourceNodes.count', { count: counts.byResource.get(id) ?? 0 })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </IconsContext.Provider>
      </div>

      <div>
        <div id={purityLabel} className="mb-1 text-xs text-muted">{t('resourceNodes.purityLabel')}</div>
        <ul aria-labelledby={purityLabel} className="flex flex-col">
          {PURITIES.map(p => {
            const on = filter.purities.has(p);
            const rate = rates.purity(p);
            return (
              <li key={p}>
                <button type="button" aria-pressed={on} title={rate?.hint} onClick={() => togglePurity(p)} className={`${ROW} ${on ? 'text-fg' : 'text-muted'}`}>
                  <PurityDot purity={p} className={on ? '' : 'opacity-40'} />
                  <span className={`min-w-0 flex-1 truncate ${on ? PURITY_TEXT[p] : ''}`}>{t(`resourceNodes.purity.${p}`)}</span>
                  {rate && <span className="shrink-0 text-xs text-muted tabular-nums" data-testid="purity-rate">{rate.range}</span>}
                  <span className="shrink-0 font-display tabular-nums">{t('resourceNodes.count', { count: counts.byPurity[p] })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {summary && filter.occupancy && (
        <>
          <div>
            <div id={occupancyLabel} className="mb-1 text-xs text-muted">{t('resourceNodes.occupancyLabel')}</div>
            <ul aria-labelledby={occupancyLabel} className="flex flex-col">
              {OCCUPANCIES.map(o => {
                const on = filter.occupancy === o;
                return (
                  <li key={o}>
                    <button type="button" aria-pressed={on} onClick={() => setOccupancy(o)} className={`${ROW} ${on ? 'text-fg' : 'text-muted'}`}>
                      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full border border-current ${on ? 'bg-accent' : ''}`} />
                      <span className="min-w-0 flex-1 truncate">{t(`resourceNodes.occupancy.${o}`)}</span>
                      <span className="shrink-0 font-display tabular-nums">{t('resourceNodes.count', { count: counts.byOccupancy[o] })}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <section aria-labelledby={extractorsLabel}>
            <h3 id={extractorsLabel} className="mb-1 text-xs font-normal text-muted">{t('resourceNodes.extractorsTitle')}</h3>
            <ul className="flex flex-col text-sm">
              {summary.byKind.map(([kind, n]) => (
                <li key={kind} className="flex h-7 items-center gap-2 px-2">
                  <span className="min-w-0 flex-1 truncate">{t(`resourceNodes.extractorKinds.${kind}`)}</span>
                  <span className="shrink-0 font-display tabular-nums">{t('resourceNodes.count', { count: n })}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 px-2 text-xs text-muted">{t('resourceNodes.summaryNodes', { count: summary.nodes })}</p>
            <p className="flex items-center gap-1.5 px-2 text-xs">
              <ShardPips shards={1} slots={1} />
              <span>{t('resourceNodes.summaryShards', { count: summary.shards })}</span>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
