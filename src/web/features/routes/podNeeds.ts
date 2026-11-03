import type { Item } from '../../../shared/dataset.js';
import type { Locale } from '../../../shared/types.js';

/** What the open drop pods of a route need to be opened (spec §10.6). */
export interface PodNeeds {
  /** Open pods on the route. */
  pods: number;
  /** Items summed over the pods, most first. */
  items: { item: string; amount: number }[];
  /** Pods opened with power: each is powered on its own, so only the count and the largest need. */
  power: { pods: number; maxMw: number } | null;
  /** Pods that need nothing. */
  free: number;
  /** Pods without requirement data. */
  unknown: number;
}

/** The needs of the route's drop pods that are not checked yet; null when it has none. */
export function podNeeds(stops: readonly Item[], isDone: (name: string) => boolean, locale: Locale): PodNeeds | null {
  const items = new Map<string, number>();
  let pods = 0, powerPods = 0, maxMw = 0, free = 0, unknown = 0;
  for (const s of stops) {
    if (s.type !== 'hard_drive' || isDone(s.name)) continue;
    pods++;
    const pod = s.extra?.pod;
    if (!pod) { unknown++; continue; }
    const needsItem = pod.item !== null && pod.amount > 0;
    if (needsItem) items.set(pod.item![locale], (items.get(pod.item![locale]) ?? 0) + pod.amount);
    if (pod.power > 0) { powerPods++; maxMw = Math.max(maxMw, pod.power); }
    if (!needsItem && pod.power <= 0) free++;
  }
  if (pods === 0) return null;
  return {
    pods,
    items: [...items].map(([item, amount]) => ({ item, amount })).sort((a, b) => b.amount - a.amount || a.item.localeCompare(b.item)),
    power: powerPods > 0 ? { pods: powerPods, maxMw } : null,
    free,
    unknown,
  };
}
