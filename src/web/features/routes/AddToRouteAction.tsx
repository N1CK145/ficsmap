import { useTranslation } from 'react-i18next';
import type { Item } from '../../../shared/dataset.js';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { canEditRoute, defaultRouteName, useRouteDraft, useRoutesQuery, type DraftEnv } from './useRoutes.js';

/**
 * [+ Add to route] in the item panel (spec §10.2, §10.6): adds the item to the open route when the
 * user may change it, else starts a new route with the item as its start; either way the map goes
 * to route mode.
 */
export function AddToRouteAction({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const routes = useRoutesQuery(ctx.worldId).data;
  const draft = useRouteDraft(s => s.draft);
  const editing = useUiStore(s => s.interactionMode === 'route');
  const inRoute = draft !== null && (draft.start === item.name || draft.stops.includes(item.name));

  const add = () => {
    const env: DraftEnv = { index: ctx.index, toast: ctx.toast, t };
    const s = useRouteDraft.getState();
    const route = s.draft?.id == null ? undefined : routes?.find(r => r.id === s.draft?.id);
    const editable = s.draft !== null && (editing || canEditRoute(route, s.draft.id, ctx.me, ctx.world));
    if (!editable) s.newDraft(defaultRouteName(ctx.queryClient, ctx.worldId, t));
    if (!editing) useRouteDraft.getState().beginEdit(env);
    useRouteDraft.getState().apply({ type: 'add', actors: [item.name] }, env);
  };

  return (
    <Button className="w-full" disabled={inRoute} onClick={add}>{t('routes.addToRoute')}</Button>
  );
}
