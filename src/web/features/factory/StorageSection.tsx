import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LITRES_PER_M3, storageFigures, storageTotals, type StoredItem } from '../../../shared/factory/inventory.js';
import type { FactorySnapshot } from '../../../shared/factory/snapshot.js';
import { Button } from '../../components/Button.js';
import { fieldClass } from '../../components/Field.js';
import { SearchIcon } from '../../components/icons.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { slotAmount } from './Inventory.js';
import { Cell, ShowOnMap, TABLE, TD, TD_FIRST, TH, THEAD, TR } from './parts.js';

/** Rows shown before "Show all" (a search shows every match). */
const FIRST_ROWS = 12;

/** Whether an item matches a search: its name in either language or its class, ignoring case and accents. */
export function itemMatches(item: string, query: string, labels: FactoryLabels): boolean {
  const q = fold(query.trim());
  if (q === '') return true;
  return [labels.item(item, 'de'), labels.item(item, 'en'), item].some(s => fold(s).includes(q));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * "Lager": what lies in the factory's storage (containers, storage boxes, fluid buffers, Dimensional Depot uploaders)
 * per item, most first: how much, in how many slots and storages, with "On the map" for the storages holding it; and
 * separately what lies in the Dimensional Depot. One search filters both. The first rows, then "Show all". A snapshot
 * extracted before inventories were read says so.
 */
export function StorageSection({ worldId, snapshot, labels, fmt }: { worldId: string; snapshot: FactorySnapshot; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  // Most first, fluids by their m³ (the save counts them in litres).
  const totals = useMemo(() => {
    const amount = (s: StoredItem) => (labels.isFluid(s.item) ? s.total / LITRES_PER_M3 : s.total);
    return storageTotals(snapshot).sort((a, b) => amount(b) - amount(a) || a.item.localeCompare(b.item));
  }, [snapshot, labels]);
  const figures = useMemo(() => storageFigures(snapshot), [snapshot]);
  const depot = useMemo(() => [...(snapshot.depot ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [snapshot]);
  const known = snapshot.meta.inventories === true;

  if (!known) {
    return (
      <Window title={t('factory.storage.title')}>
        <p className="text-sm text-muted" data-testid="storage-unknown">{t('factory.storage.unknown')}</p>
      </Window>
    );
  }

  const matches = totals.filter(s => itemMatches(s.item, query, labels));
  const depotMatches = depot.filter(([item]) => itemMatches(item, query, labels));
  const searching = query.trim() !== '';
  const shown = searching || all ? matches : matches.slice(0, FIRST_ROWS);
  const subtitle = figures.buildings > 0
    ? t('factory.storage.subtitle', { buildings: figures.buildings, used: figures.used, slots: figures.slots })
    : t('factory.storage.noStorage');
  const cols = { total: t('factory.storage.total'), stacks: t('factory.storage.stacks'), holders: t('factory.storage.holders') };

  return (
    <Window title={t('factory.storage.title')} subtitle={subtitle} bodyClassName="flex flex-col gap-4 py-3" className="scroll-mt-4" as="section">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3">
        <div className={`flex min-w-0 max-w-md flex-[1_1_16rem] items-center gap-2 ${fieldClass({}, 'focus-within:border-accent max-[899px]:h-11')}`}>
          <SearchIcon className="text-muted" />
          <label htmlFor={searchId} className="sr-only">{t('factory.storage.search')}</label>
          <input
            id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off"
            placeholder={t('factory.storage.searchPlaceholder')}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted max-[899px]:text-base"
          />
        </div>
        <p className="text-sm text-muted tabular-nums" aria-live="polite" data-testid="storage-showing">
          {searching ? t('factory.storage.showing', { shown: matches.length, total: totals.length }) : ''}
        </p>
      </div>

      <section aria-labelledby={`${searchId}-stored`} className="flex flex-col gap-1">
        <SectionHeading as="h3" id={`${searchId}-stored`} className="px-3">{t('factory.storage.storages')}</SectionHeading>
        {totals.length === 0 ? <p className="px-3 text-sm text-muted">{t('factory.storage.none')}</p>
          : matches.length === 0 ? <p className="px-3 text-sm text-muted" data-testid="storage-no-match">{t('factory.storage.noMatch', { query: query.trim() })}</p>
          : (
            <table role="table" className={TABLE} data-testid="storage-table">
              <thead role="rowgroup" className={THEAD}>
                <tr role="row">
                  <th role="columnheader" scope="col" className={TH}>{t('factory.storage.item')}</th>
                  <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.total}</th>
                  <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.stacks}</th>
                  <th role="columnheader" scope="col" className={`${TH} text-right`}>{cols.holders}</th>
                  <th role="columnheader" scope="col" className={TH}><span className="sr-only">{t('factory.showOnMap')}</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="max-sm:block">
                {shown.map(s => <StoredRow key={s.item} s={s} worldId={worldId} labels={labels} fmt={fmt} cols={cols} />)}
              </tbody>
            </table>
          )}
        {!searching && matches.length > FIRST_ROWS && (
          <div className="px-3">
            <Button variant="ghost" size="sm" onClick={() => setAll(x => !x)} aria-expanded={all}>
              {all ? t('factory.showFewer') : t('factory.showAll', { count: matches.length })}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby={`${searchId}-depot`} className="flex flex-col gap-1 px-3" data-testid="storage-depot">
        <SectionHeading as="h3" id={`${searchId}-depot`}>{t('factory.storage.depot')}</SectionHeading>
        {depot.length === 0 ? <p className="text-sm text-muted">{t('factory.storage.depotEmpty')}</p> : (
          <>
            <p className="text-xs text-muted max-[899px]:text-sm">{t('factory.storage.depotSubtitle', { count: depot.length })}</p>
            {depotMatches.length === 0 ? <p className="text-sm text-muted">{t('factory.storage.noMatch', { query: query.trim() })}</p> : (
              <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2 xl:grid-cols-3">
                {depotMatches.map(([item, amount]) => {
                  const name = labels.item(item, fmt.lang);
                  return (
                    <li key={item} className="flex min-w-0 items-center gap-2 border-b border-line/60 py-1">
                      <GameIcon cls={item} px={20} placeholder />
                      <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                      <span className="shrink-0 font-display font-semibold tabular-nums">{slotAmount(item, amount, labels, fmt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </Window>
  );
}

function StoredRow({ s, worldId, labels, fmt, cols }: {
  s: StoredItem; worldId: string; labels: FactoryLabels; fmt: FactoryFormat; cols: Record<'total' | 'stacks' | 'holders', string>;
}) {
  const { t } = useTranslation();
  const name = labels.item(s.item, fmt.lang);
  const ids = s.holders.map(h => h.id);
  return (
    <tr role="row" className={TR} data-item={s.item}>
      <Cell className={TD_FIRST}>
        <span className="flex items-center gap-2">
          <GameIcon cls={s.item} px={24} placeholder />
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{name}</span>
          <span className="ml-auto sm:hidden"><ShowOnMap worldId={worldId} ids={ids} label={name} compact /></span>
        </span>
      </Cell>
      <Cell label={cols.total} className={`${TD} text-right`}>
        <span className="font-display font-semibold">{slotAmount(s.item, s.total, labels, fmt)}</span>
      </Cell>
      <Cell label={cols.stacks} className={`${TD} text-right`}>{fmt.int(s.stacks)}</Cell>
      <Cell label={cols.holders} className={`${TD} text-right`}>
        <span title={t('factory.storage.holdersCount', { count: s.holders.length })}>{fmt.int(s.holders.length)}</span>
      </Cell>
      <Cell className="px-2 py-1 text-right max-sm:hidden">
        <ShowOnMap worldId={worldId} ids={ids} label={name} compact />
      </Cell>
    </tr>
  );
}
