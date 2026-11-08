/**
 * Thinning of a world's factory snapshots (the timeline of the factory map). Pure; the server applies it after every
 * stored snapshot and in its hourly housekeeping (`src/server/domain/snapshots.ts`).
 *
 * Ages are measured back from the world's NEWEST snapshot's save time, not the wall clock, so a world nobody plays is
 * never emptied. Per session (snapshots of different sessions are never thinned against each other):
 * - age up to 2 days: every snapshot is kept;
 * - over 2 days up to 30 days: the newest per clock hour;
 * - over 30 days up to 365 days: the newest per calendar day;
 * - older: the newest per ISO week (Monday to Sunday).
 * Hours, days and weeks are UTC buckets of the save time (a server has no player time zone to go by). A snapshot is
 * thinned when the same session has a newer snapshot in the same bucket of the snapshot's own tier, so each bucket
 * keeps its newest snapshot whichever tier that one is in. The world's newest snapshot and the ones passed as `keep`
 * (the last import's) are never thinned.
 *
 * The UI names these limits in `import.older.thinning` (i18n); change both together.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Every snapshot up to this age is kept. */
export const KEEP_ALL_MS = 2 * DAY_MS;
/** Up to this age the newest per hour is kept. */
export const HOURLY_UNTIL_MS = 30 * DAY_MS;
/** Up to this age the newest per day is kept; older ones the newest per ISO week. */
export const DAILY_UNTIL_MS = 365 * DAY_MS;

export interface RetainedSnapshot {
  id: number;
  /** Unix ms. */
  saveTime: number;
}

type Tier = 'all' | 'hour' | 'day' | 'week';

function tierOf(age: number): Tier {
  if (age <= KEEP_ALL_MS) return 'all';
  if (age <= HOURLY_UNTIL_MS) return 'hour';
  if (age <= DAILY_UNTIL_MS) return 'day';
  return 'week';
}

/** UTC hour, UTC day and ISO week (UTC, starting Monday; 1970-01-01 was a Thursday) of a save time. */
function bucketsOf(saveTime: number): { hour: number; day: number; week: number } {
  const day = Math.floor(saveTime / DAY_MS);
  return { hour: Math.floor(saveTime / HOUR_MS), day, week: Math.floor((day + 3) / 7) };
}

/**
 * The snapshots of ONE session to thin, measured back from `reference` (the world's newest save time). `keep`: ids
 * that stay whatever the rule says.
 */
export function thinSession(list: readonly RetainedSnapshot[], reference: number, keep: ReadonlySet<number> = new Set()): number[] {
  const newestFirst = [...list].sort((a, b) => b.saveTime - a.saveTime || b.id - a.id);
  const seen = { hour: new Set<number>(), day: new Set<number>(), week: new Set<number>() };
  const out: number[] = [];
  for (const s of newestFirst) {
    const tier = tierOf(reference - s.saveTime);
    const b = bucketsOf(s.saveTime);
    if (tier !== 'all' && seen[tier].has(b[tier]) && !keep.has(s.id)) out.push(s.id);
    seen.hour.add(b.hour);
    seen.day.add(b.day);
    seen.week.add(b.week);
  }
  return out;
}

/**
 * The snapshots of a world to thin (ids), per session, measured back from the world's newest snapshot. The newest
 * snapshot and the ids in `keep` stay.
 */
export function snapshotsToThin(
  list: readonly (RetainedSnapshot & { sessionName: string })[], keep: Iterable<number> = [],
): number[] {
  if (list.length === 0) return [];
  let newest = list[0]!;
  for (const s of list) if (s.saveTime > newest.saveTime || (s.saveTime === newest.saveTime && s.id > newest.id)) newest = s;
  const kept = new Set(keep);
  kept.add(newest.id);
  const bySession = new Map<string, RetainedSnapshot[]>();
  for (const s of list) {
    let group = bySession.get(s.sessionName);
    if (!group) bySession.set(s.sessionName, (group = []));
    group.push(s);
  }
  return [...bySession.values()].flatMap(group => thinSession(group, newest.saveTime, kept));
}
