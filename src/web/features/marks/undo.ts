import { create } from 'zustand';
import type { RestoreRow } from '../../../shared/api.js';

/** What it takes to reverse one of the user's own mark changes (spec §10.3). */
export type UndoEntry =
  | { kind: 'single'; actor: string; prev: boolean; prevMismatch: boolean }
  | { kind: 'bulk'; rows: RestoreRow[] };

export const UNDO_LIMIT = 20;

/** The stack with `e` on top, keeping only the newest UNDO_LIMIT entries. */
export function pushUndo(stack: readonly UndoEntry[], e: UndoEntry): UndoEntry[] {
  return [...stack, e].slice(-UNDO_LIMIT);
}

interface UndoState {
  stack: UndoEntry[];
  push(e: UndoEntry): void;
  /** Removes and returns the newest entry. Running it is the caller's job (see useUndoShortcut.ts). */
  pop(): UndoEntry | undefined;
  /** Removes this entry wherever it is (a toast's Undo); false if it is gone already. */
  remove(e: UndoEntry): boolean;
  /** Entering another world starts a fresh stack. */
  clear(): void;
}

/** The current user's undo stack in this tab. */
export const useUndoStack = create<UndoState>()((set, get) => ({
  stack: [],
  push: e => set(s => ({ stack: pushUndo(s.stack, e) })),
  pop: () => {
    const top = get().stack.at(-1);
    if (top) set(s => ({ stack: s.stack.slice(0, -1) }));
    return top;
  },
  remove: e => {
    if (!get().stack.includes(e)) return false;
    set(s => ({ stack: s.stack.filter(x => x !== e) }));
    return true;
  },
  clear: () => set({ stack: [] }),
}));
