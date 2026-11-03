const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000], ['month', 30 * 86_400_000], ['week', 7 * 86_400_000],
  ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1000],
];

/** "2 hours ago", in the largest unit that fits. */
export function formatRelative(at: number, now: number, locale: string): string {
  const diff = at - now;
  const [unit, ms] = UNITS.find(([, ms]) => Math.abs(diff) >= ms) ?? ['second', 1000];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(diff / ms), unit);
}
