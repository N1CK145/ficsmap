import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { SseEvent } from '../../../shared/sse.js';
import { collect, dispatchSse, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { queryKeys } from '../../app/queryKeys.js';

export type LiveStatus = 'live' | 'connecting' | 'offline';

/** The world stream's state, for the header dot. */
export const useLiveStatus = create<{ status: LiveStatus; setStatus(s: LiveStatus): void }>()(set => ({
  status: 'connecting',
  setStatus: status => set({ status }),
}));

const EVENT_TYPES = Object.keys({
  mark: true, 'marks-bulk': true, import: true, world: true, members: true, removed: true, deleted: true, routes: true, snapshots: true,
} satisfies Record<SseEvent['type'], true>);

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Keeps the world's event stream open while mounted and hands every event to the features'
 * `sseHandlers`. There is no replay (spec §9): each (re)connect refetches world, marks, routes and snapshots,
 * and the handlers skip events at or below the loaded rev. The first open refetches too: an event sent
 * between the initial GET and the subscription would otherwise be lost.
 */
export function useWorldEvents(worldId: string, ctx: WorldCtx): LiveStatus {
  const features = useFeatures();
  const ctxRef = useRef(ctx);
  useEffect(() => { ctxRef.current = ctx; });
  const queryClient = ctx.queryClient;

  useEffect(() => {
    const { setStatus } = useLiveStatus.getState();
    const handlers = collect(features, 'sseHandlers');
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = RECONNECT_MIN_MS;

    const onMessage = (m: MessageEvent<string>) => {
      let e: SseEvent;
      try {
        e = JSON.parse(m.data) as SseEvent;
      } catch {
        return;
      }
      dispatchSse(handlers, e, ctxRef.current);
    };

    const connect = () => {
      setStatus('connecting');
      const es = new EventSource(`/api/worlds/${encodeURIComponent(worldId)}/events`);
      source = es;
      es.onopen = () => {
        delay = RECONNECT_MIN_MS;
        setStatus('live');
        for (const queryKey of [queryKeys.world(worldId), queryKeys.marks(worldId), queryKeys.routes(worldId), queryKeys.snapshots(worldId)]) {
          void queryClient.invalidateQueries({ queryKey });
        }
      };
      es.onerror = () => {
        setStatus('offline');
        // While CONNECTING the browser retries by itself. An answer that is not a stream closes it for
        // good: a proxy 502 during a restart, or a 401/404 when the session ended or the world is gone.
        // Refetching me and the world lets those surface (login redirect, "World not found"); this
        // hook then tries again with a growing delay.
        if (es.readyState !== EventSource.CLOSED) return;
        es.close();
        void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      };
      for (const type of EVENT_TYPES) es.addEventListener(type, onMessage);
    };

    connect();
    return () => {
      clearTimeout(timer);
      source?.close();
      setStatus('connecting');
    };
  }, [worldId, queryClient, features]);

  return useLiveStatus(s => s.status);
}
