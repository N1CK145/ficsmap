import { useTranslation } from 'react-i18next';
import type { Item } from '../../../../shared/dataset.js';
import { detectLocale } from '../../../../shared/i18n.js';
import type { WorldCtx } from '../../../app/feature.js';
import { Panel } from '../../../components/Panel.js';
import { useCrashSites } from '../useCrashSites.js';

/** Drop pods: the items around the crash site, its threats and notes (crash-sites.json). Nothing while that is loading or missing. */
export function CrashSite({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const site = useCrashSites(ctx.me.datasetVersion).data?.[item.name];
  if (!site) return null;
  const german = detectLocale([i18n.language]) === 'de';
  return (
    <Panel title={t('item.crashSite.title')}>
      <div className="flex flex-col gap-3 text-sm">
        <section>
          <h3 className="mb-1 font-medium">{t('item.crashSite.items')}</h3>
          {site.items.length === 0 ? <p className="text-muted">{t('item.crashSite.none')}</p> : (
            <ul className="flex flex-col gap-0.5">
              {site.items.map((i, n) => (
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
