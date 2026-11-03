import { useTranslation } from 'react-i18next';
import type { PodNeeds } from './podNeeds.js';

/** "To open the pods": what the route's open drop pods need, summed (spec §10.6). Nothing without open pods. */
export function PodNeedsList({ needs }: { needs: PodNeeds | null }) {
  const { t } = useTranslation();
  if (!needs) return null;
  return (
    <section aria-label={t('routes.podNeeds.title')} className="flex flex-col gap-1 rounded border border-line p-2 text-sm">
      <h4 className="font-medium">{t('routes.podNeeds.title')}</h4>
      {needs.items.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {needs.items.map(i => (
            <li key={i.item} className="flex justify-between gap-3">
              <span>{i.item}</span>
              <span className="font-display tabular-nums">{t('routes.podNeeds.amount', { amount: i.amount })}</span>
            </li>
          ))}
        </ul>
      )}
      {needs.power && <p>⚡ {t('routes.podNeeds.power', { count: needs.power.pods, mw: needs.power.maxMw })}</p>}
      {needs.free > 0 && <p className="text-muted">{t('routes.podNeeds.free', { count: needs.free })}</p>}
      {needs.unknown > 0 && <p className="text-muted">{t('routes.podNeeds.unknown', { count: needs.unknown })}</p>}
    </section>
  );
}
