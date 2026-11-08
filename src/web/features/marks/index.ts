import { getI18n } from 'react-i18next';
import type { FeatureModule } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { applyMarkEvent } from '../live/applyEvents.js';
import { useUiStore } from '../../app/store.js';
import { useRemotePulse } from '../live/pulse.js';
import { CheckAction } from './CheckAction.js';
import type { MarksCache } from './useMarks.js';

/** Checking items (the item panel's Check action) and the live mark updates; Ctrl+Z is useUndoShortcut. */
export const marksFeature: FeatureModule = {
  id: 'marks',
  itemActions: [{ id: 'check', order: 0, Component: CheckAction }],
  sseHandlers: {
    mark: (e, ctx) => {
      const key = queryKeys.marks(ctx.worldId);
      const c = ctx.queryClient.getQueryData<MarksCache>(key);
      if (!c) return;
      const next = applyMarkEvent(c, e);
      if (next === c) return;
      ctx.queryClient.setQueryData(key, next);
      // Only a change that shows on the map pulses: not one hidden under a pending write, and not the
      // echo of the user's own write.
      if (next.marks !== c.marks && !next.pending.has(e.actor) && e.by !== ctx.me.id) useRemotePulse.getState().start(e.actor);
    },
    'marks-bulk': (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.marks(ctx.worldId) }); },
    import: (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.marks(ctx.worldId) }); },
    deleted: (_e, ctx) => {
      // The owner's own delete navigates and toasts itself (DangerZone).
      if (useUiStore.getState().selfLeaving === ctx.worldId) return;
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      ctx.navigate('/?list=1');
      ctx.toast.show({ message: getI18n().t('world.deleted') });
    },
    removed: (e, ctx) => {
      if (e.userId === ctx.me.id && useUiStore.getState().selfLeaving !== ctx.worldId) ctx.navigate('/removed');
    },
    world: (_e, ctx) => {
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.world(ctx.worldId) });
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
    },
    // Joins, removals and role changes: the world (members, and the user's own role) and the world list's role badge.
    members: (_e, ctx) => {
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.world(ctx.worldId) });
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
    },
  },
};
