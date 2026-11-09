/**
 * A user's own preferences, stored on the account (`users.prefs`), so they follow the user to every device.
 * A key that is left out has its default.
 */
export interface UserPrefs {
  /**
   * How far one turn of the mouse wheel zooms, as a factor of the normal speed (1 = normal, 2 = twice as far,
   * 0.5 = half as far). Used by the map and the flow diagrams.
   */
  wheelSpeed?: number;
}

export const WHEEL_SPEED = { min: 0.25, max: 3, step: 0.05, default: 1 } as const;

/** The speeds the profile page's slider offers, with 1× in the middle; the API takes any value on the 0.05 grid. */
export const WHEEL_SPEED_STOPS: readonly number[] = [0.25, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** The index of the stop nearest to `speed` (by ratio, so 0.3 goes to 0.25 rather than 0.4). */
export function nearestWheelSpeedStop(speed: number): number {
  let best = 0;
  for (let i = 1; i < WHEEL_SPEED_STOPS.length; i++) {
    if (Math.abs(Math.log(WHEEL_SPEED_STOPS[i]! / speed)) < Math.abs(Math.log(WHEEL_SPEED_STOPS[best]! / speed))) best = i;
  }
  return best;
}

/** A wheel speed the server accepts: within the range and on the 0.05 grid. */
export function isWheelSpeed(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < WHEEL_SPEED.min || v > WHEEL_SPEED.max) return false;
  const steps = v / WHEEL_SPEED.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** Rounds to the 0.05 grid, which also removes float noise such as 1.1500000000000001. */
export function roundWheelSpeed(v: number): number {
  const perUnit = Math.round(1 / WHEEL_SPEED.step);
  return Math.round(v * perUnit) / perUnit;
}

/** The valid keys of stored or received preferences; anything else (unknown keys, bad values, not an object) is dropped. */
export function cleanPrefs(raw: unknown): UserPrefs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  return isWheelSpeed(r.wheelSpeed) ? { wheelSpeed: roundWheelSpeed(r.wheelSpeed) } : {};
}
