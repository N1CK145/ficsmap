import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ActivityDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { useDateTimeFormat } from '../../app/dates.js';
import { formatRelative } from '../../app/format.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { usePresentIds } from '../live/presence.js';
import { useMe, useWorld } from '../worlds/queries.js';

/** The i18n key of an entry's sentence; a role change to `member` by the member themselves is stepping down. */
function sentenceKey(e: ActivityDto): string {
  if (e.kind !== 'role') return `activity.kind.${e.kind}`;
  if (e.detail === 'admin') return 'activity.kind.roleAdmin';
  return e.by && e.target && e.by.id === e.target.id ? 'activity.kind.stepDown' : 'activity.kind.roleMember';
}

/**
 * The world's activity (sidebar panel): who else has the world open right now (from the live stream's presence),
 * then the newest changes from `GET /api/worlds/:id/activity`, each as a sentence with how long ago. Live events
 * refetch it (index.ts).
 */
export function ActivityPanel({ worldId }: { worldId: string }) {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const world = useWorld(worldId).data;
  const present = usePresentIds(worldId);
  const feed = useQuery({
    queryKey: queryKeys.activity(worldId),
    queryFn: () => api<ActivityDto[]>('GET', `/api/worlds/${encodeURIComponent(worldId)}/activity`),
  });
  const full = useDateTimeFormat({ dateStyle: 'medium', timeStyle: 'short' });
  const others = (world?.members ?? []).filter(m => m.userId !== me?.id && present.includes(m.userId));
  const someone = t('activity.someone');
  const now = Date.now();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {others.length > 0
          ? t('activity.hereNow', { names: others.map(m => m.displayName).join(', ') })
          : <span className="text-muted">{t('activity.alone')}</span>}
      </p>
      {feed.isPending && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {feed.isError && (
        <div role="alert" className="flex items-center gap-2 text-sm">
          <span>{t('activity.loadFailed')}</span>
          <Button size="sm" onClick={() => void feed.refetch()}>{t('common.retry')}</Button>
        </div>
      )}
      {feed.data?.length === 0 && <p className="text-sm text-muted">{t('activity.empty')}</p>}
      {feed.data && feed.data.length > 0 && (
        <ul aria-label={t('activity.recent')} className="flex flex-col divide-y divide-line">
          {feed.data.map(e => (
            <li key={e.id} className="flex flex-col py-1.5">
              <p className="text-sm">
                {t(sentenceKey(e), { name: e.by?.name ?? someone, target: e.target?.name ?? someone, detail: e.detail ?? '', count: e.count })}
              </p>
              <time dateTime={new Date(e.at).toISOString()} title={full.format(e.at)} className="text-xs text-muted">
                {formatRelative(e.at, now, i18n.language)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
