import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { MachineData, TierKey } from '../../../shared/machines.js';
import { api, ApiClientError } from '../../app/api.js';
import { worldPath } from '../../app/pages.js';
import { loadMachineWikiTiers, saveMachineWikiTiers } from '../../app/persist.js';
import { queryKeys } from '../../app/queryKeys.js';

/**
 * The machine wiki data of a dataset version (`/data/<v>/machines.json`). `null` for a dataset built
 * without it; undefined while loading or while not `enabled` (fetched when the wiki page opens or the search is used).
 */
export function useMachineData(version: string, enabled = true): { data: MachineData | null | undefined; failed: boolean } {
  const q = useQuery({
    queryKey: queryKeys.machines(version),
    enabled,
    queryFn: async () => {
      try {
        return await api<MachineData>('GET', `/data/${encodeURIComponent(version)}/machines.json`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });
  return { data: q.data, failed: q.isError };
}

/** The wiki page's id, its path under the world (`/w/:id/wiki`). */
export const WIKI_PAGE = 'wiki';

/** `/w/<world>/wiki`, with an entry `/w/<world>/wiki/<entry id>` (e.g. `Build_ConstructorMk1_C`). */
export function wikiPath(worldId: string, entry?: string | null): string {
  return entry ? worldPath(worldId, WIKI_PAGE, entry) : worldPath(worldId, WIKI_PAGE);
}

interface MachineWikiState {
  query: string;
  /** The unlock filter (tiers, MAM, Shop); empty shows every entry. Remembered on the device. */
  tiers: TierKey[];
  setQuery(query: string): void;
  setTiers(tiers: TierKey[]): void;
}

/**
 * The wiki's search text, kept while the wiki page is not shown (this tab only), and its tier filter (remembered on
 * the device). The open entry is in the URL (`wikiPath`); anything can open one by navigating there.
 */
export const useMachineWiki = create<MachineWikiState>()(set => ({
  query: '',
  tiers: loadMachineWikiTiers(),
  setQuery: query => set({ query }),
  setTiers: tiers => {
    saveMachineWikiTiers(tiers);
    set({ tiers });
  },
}));
