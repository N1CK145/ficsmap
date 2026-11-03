/** How long a new conflict's badge pulses (spec §10.1: "pulsing once"). */
export const CONFLICT_PULSE_MS = 1000;

/**
 * Actors that are conflicts in `next` but were not in `prev`: a mark whose mismatch turned on, or a
 * conflict that arrived with an import refetch. `prev` null is the first load, which pulses nothing.
 */
export function newConflicts(prev: ReadonlySet<string> | null, next: ReadonlySet<string>): string[] {
  if (prev === null) return [];
  return [...next].filter(actor => !prev.has(actor));
}
