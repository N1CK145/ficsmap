import { useQuery } from '@tanstack/react-query';
import { indexDataset, type Dataset, type DatasetIndex } from '../../../shared/dataset.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

/** `version` undefined: not known yet (waits for /api/me). */
export function useDatasetQuery(version: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dataset(version ?? ''),
    enabled: version !== undefined,
    // Versioned path: the content never changes, so it is fetched once per session.
    queryFn: async () => indexDataset(await api<Dataset>('GET', `/data/${encodeURIComponent(version ?? '')}/collectibles.min.json`)),
    staleTime: Infinity,
  });
}

/** The collectibles of one dataset version, indexed by actor name. */
export function useDataset(version: string): DatasetIndex | undefined {
  return useDatasetQuery(version).data;
}
