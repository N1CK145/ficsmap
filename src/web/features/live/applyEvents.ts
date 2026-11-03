import type { MarksDto } from '../../../shared/api.js';
import type { SseEvent } from '../../../shared/sse.js';
import type { MarkState, MarksCache } from '../marks/useMarks.js';

/*
 * Pure transitions of the marks cache. "The newest server rev wins" (spec §9, plan Review Focus 2)
 * holds per actor: every write the cache learns of (event, own PUT answer) carries the world rev the
 * server gave it, and a value only replaces one with a lower rev.
 */

/** The actor's server value (`null`: unchecked) if `rev` is newer than what the cache holds for it. */
export function putMark(c: MarksCache, actor: string, state: MarkState | null, rev: number): MarksCache {
  if (rev <= (c.revs.get(actor) ?? c.baseRev)) return c;
  const marks = new Map(c.marks);
  if (state) marks.set(actor, state);
  else marks.delete(actor);
  return { ...c, marks, revs: new Map(c.revs).set(actor, rev) };
}

/**
 * The cache after a remote `mark` event. Events at or below the stream rev were seen already (or are
 * in the snapshot) and return the same object. A pending optimistic value stays in `pending`, which
 * keeps overriding the display; the server value is stored under it.
 */
export function applyMarkEvent(c: MarksCache, e: Extract<SseEvent, { type: 'mark' }>): MarksCache {
  if (e.rev <= c.rev) return c;
  const state = e.collected ? { mismatch: e.mismatch, updatedBy: e.by, updatedAt: e.at } : null;
  return { ...putMark(c, e.actor, state, e.rev), rev: e.rev };
}

/**
 * A fresh snapshot from `GET /marks`, keeping what the current cache knows that is newer: actors
 * written after the snapshot's rev, the pending writes, and the stream rev if it is already further.
 */
export function mergeSnapshot(current: MarksCache | undefined, dto: MarksDto): MarksCache {
  const marks = new Map(dto.marks.map(([actor, mismatch, updatedBy, updatedAt]) => [actor, { mismatch: mismatch === 1, updatedBy, updatedAt }]));
  const revs = new Map<string, number>();
  for (const [actor, rev] of current?.revs ?? []) {
    if (rev <= dto.rev) continue;
    revs.set(actor, rev);
    const state = current?.marks.get(actor);
    if (state) marks.set(actor, state);
    else marks.delete(actor);
  }
  return {
    rev: Math.max(current?.rev ?? dto.rev, dto.rev),
    baseRev: dto.rev,
    marks,
    revs,
    pending: current?.pending ?? new Map(),
  };
}
