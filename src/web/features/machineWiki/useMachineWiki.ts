import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { MachineData, TierKey } from '../../../shared/machines.js';
import { api, ApiClientError } from '../../app/api.js';
import { loadMachineWikiTiers, saveMachineWikiTiers } from '../../app/persist.js';
import { queryKeys } from '../../app/queryKeys.js';

/**
 * The machine wiki data of a dataset version (`/data/<v>/machines.json`). `null` for a dataset built
 * without it; undefined while loading or while not `enabled` (only fetched once the wiki opens).
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

interface MachineWikiState {
  open: boolean;
  /** The entry shown in the detail view, or null for the list only. */
  selected: string | null;
  query: string;
  /** The unlock filter (tiers, MAM, Shop); empty shows every entry. Remembered on the device. */
  tiers: TierKey[];
  /** Opens the wiki, optionally at one entry (e.g. from a search result: `show('Build_ConstructorMk1_C')`). */
  show(id?: string): void;
  hide(): void;
  select(id: string | null): void;
  setQuery(query: string): void;
  setTiers(tiers: TierKey[]): void;
}

/**
 * The wiki's own open state, selection and search text, kept while the dialog is closed (this tab
 * only), and its tier filter (remembered on the device). Anything can open it with
 * `useMachineWiki.getState().show(id?)`.
 */
export const useMachineWiki = create<MachineWikiState>()(set => ({
  open: false,
  selected: null,
  query: '',
  tiers: loadMachineWikiTiers(),
  show: id => set(s => ({ open: true, selected: id ?? s.selected })),
  hide: () => set({ open: false }),
  select: selected => set({ selected }),
  setQuery: query => set({ query }),
  setTiers: tiers => {
    saveMachineWikiTiers(tiers);
    set({ tiers });
  },
}));
