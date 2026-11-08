import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import type { WorldCtx } from '../../app/feature.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { usePageBack } from '../../components/PageActions.js';
import { useRecipes } from '../planner/useRecipes.js';
import { IconsContext, useItemIcons } from './icons.js';
import { MachineWiki, NARROW_QUERY } from './MachineWiki.js';
import { useMachineData, useMachineWiki, wikiPath } from './useMachineWiki.js';

/**
 * The wiki page (`/w/:id/wiki`, an entry at `/w/:id/wiki/<entry>`), bound to `useMachineWiki`, for the world's dataset
 * version. Choosing an entry or going back to the list is a navigation, so the browser's Back goes through the entries.
 * On a phone, where an open entry replaces the list, the page header's back control leads to the list. The recipe data
 * is loaded once an entry that can be overclocked is open: it says what a Power Shard adds to the clock speed.
 */
export function MachineWikiPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { entry = null } = useParams();
  const navigate = useNavigate();
  const narrow = useMediaQuery(NARROW_QUERY);
  const { query, setQuery, tiers, setTiers } = useMachineWiki();
  const { data, failed } = useMachineData(ctx.me.datasetVersion);
  const icons = useItemIcons(ctx.me.datasetVersion);
  const open = data?.machines.find(m => m.id === entry);
  const recipes = useRecipes(ctx.me.datasetVersion, open?.stats.clock !== undefined).index;
  usePageBack(open && narrow ? { to: wikiPath(ctx.worldId), label: t('machineWiki.back') } : null);
  if (failed) return <p role="alert">{t('machineWiki.failed')}</p>;
  if (data === undefined) return <p>{t('common.loading')}</p>;
  if (data === null) return <p>{t('machineWiki.unavailable')}</p>;
  return (
    <IconsContext.Provider value={icons}>
      <MachineWiki data={data} selected={entry} query={query} tiers={tiers} shardStep={recipes?.data.clock.perShard}
        onSelect={id => void navigate(wikiPath(ctx.worldId, id))} onQuery={setQuery} onTiers={setTiers} />
    </IconsContext.Provider>
  );
}
