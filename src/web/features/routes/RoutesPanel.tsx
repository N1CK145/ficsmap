import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { draftFromRoute, sameRoute } from './draft.js';
import { RouteEditor } from './RouteEditor.js';
import { defaultRouteName, isDirty, useRouteDraft, useRoutesQuery } from './useRoutes.js';

/** The Routes sidebar panel (spec §10.6): the saved routes, or the open route's editor. */
export function RoutesPanel({ worldId }: { worldId: string }) {
  const open = useRouteDraft(s => s.draft !== null);
  return open ? <RouteEditor worldId={worldId} /> : <RouteList worldId={worldId} />;
}

/** Name, stop count and creator per saved route; a click opens it, [+ New route] starts picking on the map. */
function RouteList({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const routes = useRoutesQuery(worldId).data;
  const startNew = () => {
    useRouteDraft.getState().newDraft(defaultRouteName(queryClient, worldId, t));
    if (useUiStore.getState().interactionMode !== 'route') useUiStore.getState().setMode('route');
  };
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" variant="primary" className="self-start" onClick={startNew}>{t('routes.new')}</Button>
      {routes && routes.length === 0 && <p className="text-sm text-muted">{t('routes.empty')}</p>}
      {routes && routes.length > 0 && (
        <ul aria-label={t('routes.listLabel')} className="flex flex-col">
          {routes.map(r => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => useRouteDraft.getState().load(r)}
                className="flex w-full flex-col chamfer px-2 py-1.5 text-left focus-ring hover:bg-raised"
              >
                <span className="truncate">{r.name}</span>
                <span className="text-sm text-muted">
                  {t('routes.summary', { count: r.stops.length, name: r.createdByName ?? t('item.someone') })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Header item without a face, alive while the world is open: asks before route mode is left with
 * unsaved changes (any way: Esc, Q, the editor's back button), keeps the open saved route in step
 * with the server while not editing, and forgets routes deleted elsewhere.
 */
export function RoutesHost({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const routes = useRoutesQuery(ctx.worldId).data;
  const editing = useUiStore(s => s.interactionMode === 'route');
  const leaving = useRouteDraft(s => s.leaving);

  useEffect(() => {
    const unsubscribe = useUiStore.subscribe((s, prev) => {
      if (s.worldId !== prev.worldId) {
        useRouteDraft.getState().reset();
        return;
      }
      if (prev.interactionMode !== 'route' || s.interactionMode === 'route') return;
      const r = useRouteDraft.getState();
      if (isDirty(r)) {
        r.requestLeave({ mode: s.interactionMode, close: false });
        useUiStore.setState({ interactionMode: 'route' });
      } else {
        r.revert();
      }
    });
    return () => {
      unsubscribe();
      useRouteDraft.getState().reset();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || shouldIgnoreGlobalKey(e)) return;
      if (useUiStore.getState().interactionMode !== 'route') return;
      // Handled here, so the item panel's Esc does not also act on this press.
      e.preventDefault();
      const r = useRouteDraft.getState();
      if (r.pickingStart) r.setPickingStart(false);
      else useUiStore.getState().setMode('inspect');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!routes) return;
    const s = useRouteDraft.getState();
    const { activeRouteId, draft, baseline } = s;
    if (activeRouteId !== null && !routes.some(r => r.id === activeRouteId)) {
      // Deleted elsewhere: an edit in progress can still be saved, as a new route.
      if (draft?.id === activeRouteId && editing) {
        useRouteDraft.setState({ draft: { ...draft, id: null }, baseline: baseline && { ...baseline, id: null }, activeRouteId: null });
      } else if (draft?.id === activeRouteId) {
        s.close();
      } else {
        useRouteDraft.setState({ activeRouteId: null });
      }
      return;
    }
    if (editing || draft?.id == null) return;
    const fresh = routes.find(r => r.id === draft.id);
    if (fresh && !sameRoute(draftFromRoute(fresh), draft)) s.load(fresh);
  }, [routes, editing]);

  const discard = () => {
    const s = useRouteDraft.getState();
    const target = s.leaving;
    s.requestLeave(null);
    if (!target) return;
    if (target.close) s.close();
    else s.revert();
    const ui = useUiStore.getState();
    if (ui.interactionMode === 'route' && target.mode !== 'route') ui.setMode(target.mode);
  };

  return (
    <ConfirmDialog
      open={leaving !== null}
      message={t('routes.discard')}
      confirmLabel={t('routes.discardConfirm')}
      danger
      onConfirm={discard}
      onCancel={() => useRouteDraft.getState().requestLeave(null)}
    />
  );
}
