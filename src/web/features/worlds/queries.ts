import { useQuery } from '@tanstack/react-query';
import type { MeDto, WorldDto, WorldSummaryDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { receivePrefs } from '../../app/prefs.js';
import { queryKeys } from '../../app/queryKeys.js';

/** The signed-in user; its preferences also go to `app/prefs.ts`, which the map and the diagrams read. */
export const useMe = () => useQuery({
  queryKey: queryKeys.me(),
  queryFn: async () => {
    const me = await api<MeDto>('GET', '/api/me');
    receivePrefs(me.prefs);
    return me;
  },
});

export const useWorlds = () =>
  useQuery({ queryKey: queryKeys.worlds(), queryFn: () => api<WorldSummaryDto[]>('GET', '/api/worlds') });

export const useWorld = (worldId: string) =>
  useQuery({ queryKey: queryKeys.world(worldId), queryFn: () => api<WorldDto>('GET', `/api/worlds/${encodeURIComponent(worldId)}`) });
