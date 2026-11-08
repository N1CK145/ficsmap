import {
  DAILY_UNTIL_MS, HOURLY_UNTIL_MS, KEEP_ALL_MS, snapshotsToThin, thinSession, type RetainedSnapshot,
} from '../../src/shared/factory/retention.js';
import { MAX_SNAPSHOTS_PER_WORLD } from '../../src/shared/factory/storage.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Sunday 2026-11-08 12:30 UTC. */
const R = Date.UTC(2026, 10, 8, 12, 30);

let nextId = 1;
const snap = (saveTime: number, sessionName = 'S'): RetainedSnapshot & { sessionName: string } => ({ id: nextId++, saveTime, sessionName });
/** The ids that stay of a list after thinning. */
function kept(list: (RetainedSnapshot & { sessionName: string })[], keep: number[] = []): number[] {
  const gone = new Set(snapshotsToThin(list, keep));
  return list.filter(s => !gone.has(s.id)).map(s => s.id);
}

describe('snapshot retention', () => {
  it('has the agreed tiers', () => {
    expect([KEEP_ALL_MS, HOURLY_UNTIL_MS, DAILY_UNTIL_MS]).toEqual([2 * DAY, 30 * DAY, 365 * DAY]);
  });

  it('thins nothing in an empty or a one-snapshot world', () => {
    expect(snapshotsToThin([])).toEqual([]);
    expect(snapshotsToThin([snap(R)])).toEqual([]);
  });

  it('keeps every snapshot of the last 2 days, however many in one hour', () => {
    const list = Array.from({ length: 120 }, (_, i) => snap(R - i * MIN));
    list.push(snap(R - 2 * DAY)); // exactly 2 days old: still kept
    expect(snapshotsToThin(list)).toEqual([]);
  });

  it('from 2 to 30 days keeps the newest per clock hour, and a lone save in its hour', () => {
    const a = snap(R);
    // Hour 10:00-11:00 UTC four days back: three saves, the newest stays.
    const h1 = snap(R - 4 * DAY - 2 * HOUR + 20 * MIN); // 10:50
    const h2 = snap(R - 4 * DAY - 2 * HOUR); // 10:30
    const h3 = snap(R - 4 * DAY - 2 * HOUR - 25 * MIN); // 10:05
    const lone = snap(R - 10 * DAY); // after a gap, alone in its hour
    expect(kept([h3, a, h2, lone, h1])).toEqual([a.id, lone.id, h1.id]);
  });

  it('a bucket keeps its newest also when that one is in a finer tier', () => {
    // R - 2 days is 12:30 UTC; 12:40 is under 2 days old (kept), 12:20 over it: same clock hour, so 12:20 goes.
    const newer = snap(R - 2 * DAY + 10 * MIN);
    const older = snap(R - 2 * DAY - 10 * MIN);
    const justOver = snap(R - 2 * DAY - 1); // 12:29:59.999, just over 2 days: goes too
    expect(snapshotsToThin([snap(R), newer, older, justOver]).sort()).toEqual([older.id, justOver.id].sort());
  });

  it('switches from hours to days after 30 days and from days to ISO weeks after 365 days', () => {
    // Exactly 30 days old: still per hour; one more millisecond: per day.
    const at30 = snap(R - 30 * DAY); // 12:30
    const at30early = snap(R - 30 * DAY - 20 * MIN); // 12:10, same hour, older: goes
    expect(kept([snap(R), at30, at30early])).not.toContain(at30early.id);
    const day31a = snap(R - 31 * DAY + HOUR); // 13:30, 31 days back
    const day31b = snap(R - 31 * DAY - 5 * HOUR); // 07:30 the same UTC day: goes
    expect(kept([snap(R), day31a, day31b])).toEqual([expect.any(Number), day31a.id]);
    // Exactly 365 days old: still per day.
    const y = R - 365 * DAY; // 2025-11-08, a Saturday, 12:30
    const yDay = snap(y);
    const yDayEarlier = snap(y - 6 * HOUR); // same day: goes
    const yFriday = snap(y - DAY); // Friday of the same ISO week, but over a year old: goes (Saturday is newer)
    const r1 = kept([snap(R), yDay, yDayEarlier, yFriday]);
    expect(r1).toContain(yDay.id);
    expect(r1).not.toContain(yDayEarlier.id);
    expect(r1).not.toContain(yFriday.id);
  });

  it('over a year keeps the newest per ISO week (Monday to Sunday, UTC)', () => {
    const newest = snap(R);
    const sunday = snap(Date.UTC(2024, 10, 10, 23, 0)); // Sunday, ends ISO week 45 of 2024
    const monday = snap(Date.UTC(2024, 10, 11, 1, 0)); // Monday, ISO week 46
    const tuesday = snap(Date.UTC(2024, 10, 12, 9, 0)); // week 46
    const friday = snap(Date.UTC(2024, 10, 15, 18, 0)); // week 46, the newest of it
    const thursday1970 = snap(Date.UTC(1970, 0, 1)); // epoch day 0 (a Thursday) shares its week with...
    const sunday1970 = snap(Date.UTC(1970, 0, 4, 12)); // ...the Sunday after it
    const monday1970 = snap(Date.UTC(1970, 0, 5)); // the next week
    const out = kept([newest, sunday, monday, tuesday, friday, thursday1970, sunday1970, monday1970]);
    expect(out).toEqual([newest, sunday, friday, sunday1970, monday1970].map(s => s.id).sort((a, b) => a - b));
  });

  it('buckets are UTC days, not the players\' local days', () => {
    // 21:30 and 22:30 UTC on 1 July: 23:30 and 00:30 in Berlin (CEST), two local days, but one UTC day: the older goes.
    const a = snap(Date.UTC(2026, 6, 1, 21, 30));
    const b = snap(Date.UTC(2026, 6, 1, 22, 30));
    // 23:30 UTC on 1 June and 00:30 UTC on 2 June: one Berlin day (01:30, 02:30), two UTC days: both stay.
    const c = snap(Date.UTC(2026, 5, 1, 23, 30));
    const d = snap(Date.UTC(2026, 5, 2, 0, 30));
    const out = kept([snap(R), a, b, c, d]);
    expect(out).not.toContain(a.id);
    expect(out).toEqual(expect.arrayContaining([b.id, c.id, d.id]));
  });

  it('measures ages from the newest snapshot, not the clock: a world nobody plays keeps its saves', () => {
    // Saves from 2020, two days of play at 10-minute intervals: all within 2 days of the newest, all stay.
    const start = Date.UTC(2020, 0, 1);
    const list = Array.from({ length: 2 * 24 * 6 }, (_, i) => snap(start + i * 10 * MIN));
    expect(snapshotsToThin(list)).toEqual([]);
  });

  it('never thins the newest snapshot nor the kept ones (the last import)', () => {
    const newest = snap(R);
    const tie = snap(R); // same save time, lower id would lose; ids break ties
    expect(snapshotsToThin([newest, tie])).toEqual([]);
    const lastImport = snap(R - 5 * DAY - 30 * MIN);
    const sameHourNewer = snap(R - 5 * DAY - 10 * MIN);
    const sameHourOlder = snap(R - 5 * DAY - 25 * MIN);
    const out = kept([newest, lastImport, sameHourNewer, sameHourOlder], [lastImport.id]);
    expect(out).toContain(lastImport.id);
    expect(out).toContain(sameHourNewer.id);
    expect(out).not.toContain(sameHourOlder.id);
  });

  it('thins per session, measured from the world\'s newest snapshot', () => {
    const a = snap(R, 'A');
    // Session B's saves in one hour, 5 days before A's newest: B's newest of that hour stays, the older one goes.
    const b1 = snap(R - 5 * DAY, 'B');
    const b2 = snap(R - 5 * DAY - 10 * MIN, 'B');
    // Session A in the same hour as b1: not thinned against B.
    const a1 = snap(R - 5 * DAY - 5 * MIN, 'A');
    expect(snapshotsToThin([a, b1, b2, a1])).toEqual([b2.id]);
    // The pure per-session function, with the reference given.
    expect(thinSession([b1, b2], R)).toEqual([b2.id]);
    expect(thinSession([b1, b2], R, new Set([b2.id]))).toEqual([]);
  });

  it('is idempotent: thinning the result again removes nothing', () => {
    const list = Array.from({ length: 2000 }, (_, i) => snap(R - i * 37 * MIN));
    const out = new Set(snapshotsToThin(list));
    expect(snapshotsToThin(list.filter(s => !out.has(s.id)))).toEqual([]);
  });

  describe('a year of saves', () => {
    const start = Date.UTC(2025, 10, 3); // a Monday
    /** Keeps thinning as the server does (after each stored snapshot) or once at the end; returns the count kept. */
    function simulate(days: number, perDay: (d: number) => number[], afterEach: boolean): number {
      let list: (RetainedSnapshot & { sessionName: string })[] = [];
      let id = 0;
      for (let d = 0; d < days; d++) {
        for (const t of perDay(d)) {
          list.push({ id: ++id, saveTime: start + d * DAY + t, sessionName: 'S' });
          if (afterEach) {
            const gone = new Set(snapshotsToThin(list));
            list = list.filter(s => !gone.has(s.id));
          }
        }
      }
      const gone = new Set(snapshotsToThin(list));
      return list.filter(s => !gone.has(s.id)).length;
    }
    /** 30 saves a day, one every 48 minutes around the clock (every clock hour has one). */
    const aroundTheClock = () => Array.from({ length: 30 }, (_, i) => i * 48 * MIN);
    /** 30 saves a day, every 30 minutes (the watcher's default interval) from 09:00 to 23:30. */
    const playDay = () => Array.from({ length: 30 }, (_, i) => 9 * HOUR + i * 30 * MIN);

    it('30 saves a day around the clock for a year: 1,067 kept (60 + 672 hours + 335 days), far below the limit', () => {
      // Last 2 days: 60 (+1, the save exactly 2 days old); 2..30 days: 28 x 24 hours; 30..365 days: 335 days, minus
      // overlaps at the tier edges.
      const n = simulate(365, aroundTheClock, false);
      expect(n).toBe(1067);
      expect(n).toBeLessThan(MAX_SNAPSHOTS_PER_WORLD * 0.6);
    });

    it('30 saves a day in a 15-hour play day for a year: 815 kept', () => {
      expect(simulate(365, playDay, false)).toBe(815);
    });

    it('thinning after every save gives the same as thinning once', () => {
      expect(simulate(120, aroundTheClock, true)).toBe(simulate(120, aroundTheClock, false));
    });

    it('later years add about one snapshot per week', () => {
      const one = simulate(365, playDay, false);
      const three = simulate(3 * 365, playDay, false);
      expect(three - one).toBeGreaterThanOrEqual(100);
      expect(three - one).toBeLessThanOrEqual(106);
    });
  });
});
