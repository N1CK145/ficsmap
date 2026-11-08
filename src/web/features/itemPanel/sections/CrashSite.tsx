import { useTranslation } from 'react-i18next';
import type { CrashSite as Site, Item } from '../../../../shared/dataset.js';
import { detectLocale } from '../../../../shared/i18n.js';
import type { WorldCtx } from '../../../app/feature.js';
import { Panel } from '../../../components/Panel.js';
import { useCrashSites } from '../useCrashSites.js';

/**
 * The site's items with one row per item and place: the dataset lists every pickup, so two piles of Motors (17 and 30)
 * show as one row of 47, in the order the item first appears. Piles at another place ("lower level") stay apart.
 */
export function sumPickups(items: Site['items']): Site['items'] {
  const rows = new Map<string, Site['items'][number]>();
  for (const i of items) {
    const key = `${i.item}\u0000${i.where ?? ''}`;
    const row = rows.get(key);
    if (row) row.amount += i.amount;
    else rows.set(key, { ...i });
  }
  return [...rows.values()];
}

/** Drop pods: the items around the crash site, its threats and notes (crash-sites.json). Nothing while that is loading or missing. */
export function CrashSite({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const site = useCrashSites(ctx.me.datasetVersion).data?.[item.name];
  if (!site) return null;
  const german = detectLocale([i18n.language]) === 'de';
  const items = sumPickups(site.items);
  return (
    <Panel title={t('item.crashSite.title')}>
      <div className="flex flex-col gap-3 text-sm">
        <section>
          <h3 className="mb-1 font-medium">{t('item.crashSite.items')}</h3>
          {items.length === 0 ? <p className="text-muted">{t('item.crashSite.none')}</p> : (
            <ul className="flex flex-col gap-0.5">
              {items.map((i, n) => (
                <li key={n} className="flex justify-between gap-3">
                  <span>{(german && i.de) || i.item}{i.where && <span className="text-muted"> · {i.where}</span>}</span>
                  <span className="font-display tabular-nums">{t('item.crashSite.amount', { amount: i.amount })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1 font-medium">{t('item.crashSite.threats')}</h3>
          {site.threats.length === 0 ? <p className="text-muted">{t('item.crashSite.none')}</p> : (
            <ul className="flex flex-col gap-0.5">
              {site.threats.map((th, n) => (
                <li key={n}>{th.count === null ? th.name : t('item.crashSite.threat', { count: th.count, name: th.name })}</li>
              ))}
            </ul>
          )}
        </section>
        {site.notes.length > 0 && (
          <section>
            <h3 className="mb-1 font-medium">{t('item.crashSite.notes')}</h3>
            <ul className="flex list-disc flex-col gap-0.5 pl-4">{site.notes.map((note, n) => <li key={n}>{note}</li>)}</ul>
          </section>
        )}
      </div>
    </Panel>
  );
}
