import { Fragment, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lostOf, type FactoryAnalysis, type ItemFlow, type MachineFlow } from '../../../shared/factory/analysis.js';
import { Button } from '../../components/Button.js';
import { ChevronDownIcon } from '../../components/icons.js';
import { Window } from '../../components/Window.js';
import { Picture } from '../planner/pictures.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { LocateContext, LossBar, ProductivityBar, ReasonBadge, ShowOnMap } from './parts.js';
import { useFactoryPage } from './timeline.js';

/** Losses below this (per minute) round to 0.0 and are not listed. */
export const MIN_LOSS = 0.05;
/** Rows shown before "Show all". */
const FIRST_ROWS = 10;

/**
 * Table classes that turn into stacked rows on a phone (below 640 px): the header goes, every cell is a line with its
 * column name in front (`data-label`).
 */
export const TABLE = 'w-full border-collapse text-sm max-sm:block';
export const THEAD = 'max-sm:sr-only';
export const TH = 'px-2 py-1.5 text-left font-display text-xs font-semibold tracking-wider text-muted uppercase whitespace-nowrap';
export const TR = 'border-t border-line max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-1 max-sm:px-3 max-sm:py-2';
export const TD = 'px-2 py-1.5 align-middle tabular-nums max-sm:flex max-sm:min-w-0 max-sm:items-baseline max-sm:justify-between max-sm:gap-2 '
  + 'max-sm:p-0 max-sm:before:shrink-0 max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]';
/** The first cell of a stacked row: the whole width on a phone. */
export const TD_FIRST = 'px-2 py-1 max-sm:col-span-2 max-sm:p-0';

/**
 * "Inefficient items": every item a machine makes below its nominal rate, the largest loss per minute first: nominal,
 * actual and lost output, the machines making it and the reason behind most of the loss. A row unfolds into its
 * machines, each with productivity, clock speed, reasons, its own loss and "Show on map".
 */
export function ItemsSection({ worldId, analysis, labels, fmt }: { worldId: string; analysis: FactoryAnalysis; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const expanded = useFactoryPage(s => s.expanded);
  const toggle = useFactoryPage(s => s.toggleItem);
  const [all, setAll] = useState(false);
  const losing = analysis.items.filter(i => i.lost >= MIN_LOSS);
  const full = analysis.items.length - losing.length;
  const shown = all ? losing : losing.slice(0, FIRST_ROWS);
  const maxLoss = losing[0]?.lost ?? 1;
  const lang = fmt.lang;

  return (
    <Window
      title={t('factory.items.title')}
      subtitle={t('factory.items.subtitle', { losing: losing.length, full })}
      bodyClassName="p-0"
    >
      {losing.length === 0 ? (
        <p className="p-3 text-sm text-muted">{t('factory.items.none')}</p>
      ) : (
        <table className={TABLE}>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH}>{t('factory.items.item')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.items.nominal')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.items.actual')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.items.lost')}</th>
              <th scope="col" className={`${TH} text-right`}>{t('factory.items.machines')}</th>
              <th scope="col" className={TH}>{t('factory.items.reason')}</th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {shown.map(it => {
              const open = expanded.includes(it.item);
              const name = labels.item(it.item, lang);
              const fluid = labels.isFluid(it.item);
              const rowsId = `factory-item-${it.item}`;
              return (
                <Fragment key={it.item}>
                  <tr className={`${TR} ${open ? 'bg-raised' : ''}`}>
                    <td className={TD_FIRST}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={rowsId}
                        onClick={() => toggle(it.item)}
                        className="flex min-h-9 w-full items-center gap-2 text-left focus-ring max-[899px]:min-h-11"
                      >
                        <ChevronDownIcon size={14} className={`text-muted motion-safe:transition-transform ${open ? '' : '-rotate-90'}`} />
                        <Picture cls={it.item} px={24} />
                        <span className="min-w-0 font-medium">{name}</span>
                      </button>
                    </td>
                    <td data-label={t('factory.items.nominal')} className={`${TD} text-right`}>{fmt.rate(it.nominal, fluid)}</td>
                    <td data-label={t('factory.items.actual')} className={`${TD} text-right`}>
                      {fmt.rate(it.actual, fluid)}
                      <span className="ml-1 text-xs text-muted">({fmt.pct(it.nominal > 0 ? it.actual / it.nominal : 1)})</span>
                    </td>
                    <td data-label={t('factory.items.lost')} className={`${TD} text-right max-sm:col-span-2`}><LossBar share={it.lost / maxLoss} label={fmt.rate(it.lost, fluid)} /></td>
                    <td data-label={t('factory.items.machines')} className={`${TD} text-right`}>{fmt.int(it.machines.length)}</td>
                    <td data-label={t('factory.items.reason')} className={TD}>{it.mainReason && <ReasonBadge reason={it.mainReason} />}</td>
                  </tr>
                  {open && (
                    <tr id={rowsId} className="bg-bg/60 max-sm:block">
                      <td colSpan={6} className="px-2 pt-1 pb-3 max-sm:block max-sm:px-3">
                        <ItemMachines worldId={worldId} item={it} labels={labels} fmt={fmt} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {losing.length > FIRST_ROWS && (
        <div className="border-t border-line p-2">
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? t('factory.showFewer') : t('factory.showAll', { count: losing.length })}
          </Button>
        </div>
      )}
    </Window>
  );
}

/** The machines making one item, most loss first, each with "Show on map"; and all of them on the map at once. */
function ItemMachines({ worldId, item, labels, fmt }: { worldId: string; item: ItemFlow; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const fluid = labels.isFluid(item.item);
  const losing = item.machines.filter(m => lostOf(m, item.item) >= MIN_LOSS);
  const name = labels.item(item.item, fmt.lang);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted max-[899px]:text-sm">
          {t('factory.items.machineSummary', { losing: losing.length, total: item.machines.length })}
        </p>
        <ShowOnMap worldId={worldId} ids={(losing.length > 0 ? losing : item.machines).map(m => m.id)} label={name} />
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {item.machines.map(m => <MachineLine key={m.id} worldId={worldId} m={m} lost={lostOf(m, item.item)} fluid={fluid} labels={labels} fmt={fmt} />)}
      </ul>
    </div>
  );
}

/**
 * One machine in a list: picture, name, what it makes and where (the biome nearby), productivity, clock speed with its
 * Power Shards, reasons, its loss and "Show on map". A row of columns from 640 px; on a phone name and map button,
 * then productivity, clock and loss, then the reasons.
 */
export function MachineLine({ worldId, m, lost, fluid, labels, fmt, recipeName }: {
  worldId: string; m: MachineFlow; lost: number | null; fluid: boolean; labels: FactoryLabels; fmt: FactoryFormat; recipeName?: string;
}) {
  const { t } = useTranslation();
  const locate = useContext(LocateContext);
  const name = labels.building(m.cls, fmt.lang);
  const where = locate(m.x, m.y);
  const detail = [recipeName, where && t('factory.routes.near', { biome: where })].filter(Boolean).join(' · ');
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[minmax(12rem,20rem)_7.5rem_7rem_minmax(9rem,1fr)_8rem_auto]">
      <span className="flex min-w-0 items-center gap-2">
        <Picture cls={labels.buildingPicture(m.cls)} px={20} />
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          {detail && <span className="block truncate text-xs text-muted max-[899px]:text-sm">{detail}</span>}
        </span>
      </span>
      <span className="justify-self-end sm:order-last"><ShowOnMap worldId={worldId} ids={[m.id]} label={name} compact /></span>
      <span className="flex items-center gap-3 sm:contents">
        <ProductivityBar value={m.productivity} band={m.band} fmt={fmt} />
        <span className="text-xs whitespace-nowrap text-muted tabular-nums max-[899px]:text-sm" title={t('factory.clockHint')}>
          {t('factory.clock', { value: fmt.pct(m.clock) })}
          {m.powerShards > 0 && (
            <span className="ml-1 text-shard" role="img" aria-label={t('factory.shards', { count: m.powerShards })} title={t('factory.shards', { count: m.powerShards })}>
              {'◆'.repeat(Math.min(3, m.powerShards))}
            </span>
          )}
        </span>
      </span>
      <span className="justify-self-end font-display font-semibold whitespace-nowrap text-conflict tabular-nums sm:order-5">
        {lost !== null && lost >= MIN_LOSS ? `−${fmt.rate(lost, fluid)}` : ''}
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap gap-1 max-sm:empty:hidden sm:order-4 sm:col-span-1">{m.reasons.map(r => <ReasonBadge key={r} reason={r} />)}</span>
    </li>
  );
}
