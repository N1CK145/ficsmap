import type { CrashSites, Item } from '../../../shared/dataset.js';
import type { Locale } from '../../../shared/types.js';

/** Loot of one kind found on the way, by stop number (1-based, as in the stop list). */
export interface FoundAt { stop: number; amount: number }

/** One kind of item the route's open pods need. */
export interface PodNeedItem {
  /** The English name: matches crash-site loot and keys the checklist ticks. */
  key: string;
  /** The name in the UI locale. */
  item: string;
  /** Summed over the pods. */
  need: number;
  /** What crash-site loot on the route does not cover: what to bring. */
  bring: number;
  /** Where the covered part lies, by stop. */
  onRoute: FoundAt[];
}

/** What the open drop pods of a route need to be opened (spec §10.6). */
export interface PodNeeds {
  /** Open pods on the route. */
  pods: number;
  /** Items still to bring first (most first), then those fully found on the way. */
  items: PodNeedItem[];
  /** Pods opened with power: each is powered on its own, so only the count and the largest need. */
  power: { pods: number; maxMw: number } | null;
  /** Pods that need nothing. */
  free: number;
  /** Pods without requirement data. */
  unknown: number;
}

/** Adds to the entry for `stop`, which is the last one if there is one (stops come in order). */
function addAt(list: FoundAt[], stop: number, amount: number): void {
  const last = list.at(-1);
  if (last?.stop === stop) last.amount += amount;
  else list.push({ stop, amount });
}

/**
 * The needs of the route's drop pods that are not checked yet; null when it has none. Walking the
 * stops in order, the loot lying around each open pod's crash site (its own included) covers what
 * that pod and later ones need, oldest loot first and each piece once; the rest has to be brought.
 * Loot at checked pods counts as gone. Inventory space is not considered.
 */
export function podNeeds(stops: readonly Item[], isDone: (name: string) => boolean, locale: Locale, sites: CrashSites): PodNeeds | null {
  const pool = new Map<string, FoundAt[]>();
  const rows = new Map<string, PodNeedItem>();
  let pods = 0, powerPods = 0, maxMw = 0, free = 0, unknown = 0;
  stops.forEach((s, i) => {
    if (s.type !== 'hard_drive' || isDone(s.name)) return;
    pods++;
    for (const loot of sites[s.name]?.items ?? []) {
      if (loot.amount <= 0) continue;
      const queue = pool.get(loot.item) ?? [];
      addAt(queue, i + 1, loot.amount);
      pool.set(loot.item, queue);
    }
    const pod = s.extra?.pod;
    if (!pod) { unknown++; return; }
    if (pod.item !== null && pod.amount > 0) {
      const key = pod.item.en;
      const row = rows.get(key) ?? { key, item: pod.item[locale], need: 0, bring: 0, onRoute: [] };
      rows.set(key, row);
      row.need += pod.amount;
      let left = pod.amount;
      const queue = pool.get(key) ?? [];
      while (left > 0 && queue.length > 0) {
        const head = queue[0]!;
        const take = Math.min(left, head.amount);
        addAt(row.onRoute, head.stop, take);
        head.amount -= take;
        left -= take;
        if (head.amount === 0) queue.shift();
      }
      row.bring += left;
    } else if (pod.power <= 0) {
      free++;
    }
    if (pod.power > 0) { powerPods++; maxMw = Math.max(maxMw, pod.power); }
  });
  if (pods === 0) return null;
  const items = [...rows.values()].sort((a, b) =>
    Number(b.bring > 0) - Number(a.bring > 0) || b.bring - a.bring || b.need - a.need || a.item.localeCompare(b.item));
  return { pods, items, power: powerPods > 0 ? { pods: powerPods, maxMw } : null, free, unknown };
}
