import { useMemo } from 'react';
import { collect, type SearchEntry, type SearchProvider, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { prepare, rank, type Prepared, type Ranked } from './match.js';

/** Prepared once per entries array a provider returns (providers keep the array while nothing changed). */
const prepared = new WeakMap<readonly SearchEntry[], Prepared<SearchEntry>[]>();

function prepareFor(provider: SearchProvider, entries: readonly SearchEntry[]): Prepared<SearchEntry>[] {
  let p = prepared.get(entries);
  if (!p) {
    p = prepare(entries.map(e => (e.weight === undefined ? { ...e, weight: provider.order } : e)));
    prepared.set(entries, p);
  }
  return p;
}

export interface SearchResults {
  /** Every match, best first. */
  results: Ranked<SearchEntry>[];
  /** The items the matches stand for (null when none): what the map highlights. */
  actors: ReadonlySet<string> | null;
  /** Some provider's data is still loading, so results may be missing. */
  loading: boolean;
}

/**
 * The search over every feature's `searchProviders`. Each provider's `useEntries` hook is called on
 * every render in a fixed order (the feature list never changes while the app runs).
 */
export function useSearch(ctx: WorldCtx, query: string, active: boolean): SearchResults {
  const features = useFeatures();
  const providers = useMemo(() => collect(features, 'searchProviders'), [features]);
  const lists = providers.map(p => p.useEntries(ctx, active));
  const all = useMemo(
    () => providers.flatMap((p, i) => (lists[i] ? prepareFor(p, lists[i]) : [])),
    // One dependency per provider: the list of providers is fixed, so the length is too.
    [providers, ...lists],
  );
  const loading = active && lists.some(l => l === undefined);
  const results = useMemo(() => rank(all, query), [all, query]);
  const actors = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) for (const a of r.entry.actors ?? []) set.add(a);
    return set.size > 0 ? set : null;
  }, [results]);
  return { results, actors, loading };
}
