import { useQuery } from '@tanstack/react-query';
import { indexRecipes, type RecipeData, type RecipeIndex } from '../../../shared/recipes.js';
import { api, ApiClientError } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

/**
 * The recipe data of a dataset version (`/data/<v>/recipes.json`), indexed. `null` for a dataset built
 * without it; undefined while loading or while not `enabled` (fetched only once the planner opens).
 */
export function useRecipes(version: string, enabled = true): { index: RecipeIndex | null | undefined; error: boolean } {
  const q = useQuery({
    queryKey: queryKeys.recipes(version),
    enabled,
    queryFn: async () => {
      try {
        const data = await api<RecipeData>('GET', `/data/${encodeURIComponent(version)}/recipes.json`);
        // `clock` came later in format 1; a file without it is treated as missing (rebuild with --docs).
        return data.format === 1 && data.clock ? indexRecipes(data) : null;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
  });
  return { index: q.data, error: q.isError };
}
