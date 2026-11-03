import { useQuery } from '@tanstack/react-query';
import type { CrashSites } from '../../../shared/dataset.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

/** The crash-site details of a dataset version (`/data/<v>/crash-sites.json`); `{}` for a dataset without them. */
export function useCrashSites(version: string | undefined) {
  return useQuery({
    queryKey: queryKeys.crashSites(version ?? ''),
    enabled: version !== undefined,
    queryFn: async () => {
      try {
        return await api<CrashSites>('GET', `/data/${encodeURIComponent(version ?? '')}/crash-sites.json`);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return {};
        throw e;
      }
    },
    staleTime: Infinity,
  });
}
