import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import type { WorldCtx } from '../../app/feature.js';
import { IconsContext, useItemIcons } from './icons.js';
import { MachineWiki } from './MachineWiki.js';
import { useMachineData, useMachineWiki, wikiPath } from './useMachineWiki.js';

/**
 * The wiki page (`/w/:id/wiki`, an entry at `/w/:id/wiki/<entry>`), bound to `useMachineWiki`, for the world's dataset
 * version. Choosing an entry or going back to the list is a navigation, so the browser's Back goes through the entries.
 */
export function MachineWikiPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { entry = null } = useParams();
  const navigate = useNavigate();
  const { query, setQuery, tiers, setTiers } = useMachineWiki();
  const { data, failed } = useMachineData(ctx.me.datasetVersion);
  const icons = useItemIcons(ctx.me.datasetVersion);
  if (failed) return <p role="alert">{t('machineWiki.failed')}</p>;
  if (data === undefined) return <p>{t('common.loading')}</p>;
  if (data === null) return <p>{t('machineWiki.unavailable')}</p>;
  return (
    <IconsContext.Provider value={icons}>
      <MachineWiki data={data} selected={entry} query={query} tiers={tiers}
        onSelect={id => void navigate(wikiPath(ctx.worldId, id))} onQuery={setQuery} onTiers={setTiers} />
    </IconsContext.Provider>
  );
}
