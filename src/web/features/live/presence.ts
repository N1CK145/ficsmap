import { create } from 'zustand';

/**
 * Who has the world open right now, from the stream's `presence` events (src/server/sse/hub.ts). Empty while the
 * stream is not live: without it nobody's presence is known.
 */
export const usePresence = create<{
  worldId: string | null;
  userIds: readonly number[];
  set(worldId: string, userIds: readonly number[]): void;
  clear(): void;
}>()(set => ({
  worldId: null,
  userIds: [],
  set: (worldId, userIds) => set({ worldId, userIds }),
  clear: () => set({ worldId: null, userIds: [] }),
}));

/** The ids of the users in `worldId` right now (none while unknown or for another world). */
export function usePresentIds(worldId: string): readonly number[] {
  return usePresence(s => (s.worldId === worldId ? s.userIds : NONE));
}

const NONE: readonly number[] = [];
