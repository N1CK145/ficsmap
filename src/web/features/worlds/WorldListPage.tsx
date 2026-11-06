import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import type { WorldSummaryDto } from '../../../shared/api.js';
import { formatRelative } from '../../app/format.js';
import { lastWorld } from '../../app/persist.js';
import { Button } from '../../components/Button.js';
import { Footer } from '../../components/Footer.js';
import { Header } from '../../components/Header.js';
import { AccountMenu } from './AccountMenu.js';
import { CreateWorldDialog } from './CreateWorldDialog.js';
import { useWorlds } from './queries.js';

/**
 * `/`: the user's worlds. Right after sign-in the world opened last opens instead, as long as it is
 * still one of the user's worlds; `?list=1` (back to the list) always shows the list.
 */
export function WorldListPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const worlds = useWorlds();
  const [creating, setCreating] = useState(false);

  const last = lastWorld();
  if (worlds.data && params.get('list') !== '1' && last && worlds.data.some(w => w.id === last)) {
    return <Navigate to={`/w/${last}`} replace />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header end={<AccountMenu />} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold">{t('worlds.title')}</h1>
          <Button variant="primary" onClick={() => setCreating(true)}>{t('worlds.new')}</Button>
        </div>
        {worlds.isPending && <p className="text-muted">{t('common.loading')}</p>}
        {worlds.isError && (
          <div role="alert" className="flex items-center gap-3">
            <span>{t('worlds.loadFailed')}</span>
            <Button size="sm" onClick={() => void worlds.refetch()}>{t('common.retry')}</Button>
          </div>
        )}
        {worlds.data?.length === 0 && <p className="text-muted">{t('worlds.empty')}</p>}
        {worlds.data && worlds.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {worlds.data.map(w => <WorldRow key={w.id} world={w} />)}
          </ul>
        )}
      </main>
      <Footer className="mt-auto" />
      <CreateWorldDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function WorldRow({ world: w }: { world: WorldSummaryDto }) {
  const { t, i18n } = useTranslation();
  const { done, total } = w.progress;
  // Rounded down, so 100 % only shows when everything is collected.
  const share = total > 0 ? Math.floor((done / total) * 100) / 100 : 0;
  return (
    <li className="flex flex-col gap-2 rounded border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/w/${w.id}`} className="min-w-0 flex-1 truncate rounded font-display text-xl font-semibold focus-ring hover:underline">
          {w.name}
        </Link>
        <span className="rounded border border-line px-2 py-0.5 text-xs font-medium text-muted">{t(`worlds.role.${w.role}`)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={t('worlds.progressLabel', { name: w.name })}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-2 flex-1 overflow-hidden rounded bg-bg"
        >
          <div className="h-full bg-fg" style={{ width: `${share * 100}%` }} />
        </div>
        <span className="font-display tabular-nums">{t('worlds.progress', { done, total })}</span>
        <span className="w-12 text-right font-display text-muted tabular-nums">{t('worlds.percent', { share })}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 text-sm text-muted">
        <span>{t('worlds.members', { count: w.memberCount })}</span>
        <span>
          {w.lastImportAt === null
            ? t('worlds.noImport')
            : t('worlds.lastImport', { when: formatRelative(w.lastImportAt, Date.now(), i18n.language) })}
        </span>
      </div>
    </li>
  );
}
