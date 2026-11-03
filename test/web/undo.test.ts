import { pushUndo, UNDO_LIMIT, useUndoStack, type UndoEntry } from '../../src/web/features/marks/undo.js';

const single = (i: number): UndoEntry => ({ kind: 'single', actor: `A${i}`, prev: false, prevMismatch: false });

describe('pushUndo', () => {
  it('keeps the last 20 entries: the 21st push drops the oldest', () => {
    let stack: UndoEntry[] = [];
    for (let i = 1; i <= 21; i++) stack = pushUndo(stack, single(i));
    expect(UNDO_LIMIT).toBe(20);
    expect(stack).toHaveLength(20);
    expect(stack[0]).toEqual(single(2));
    expect(stack.at(-1)).toEqual(single(21));
  });

  it('does not mutate the given stack', () => {
    const stack = [single(1)];
    pushUndo(stack, { kind: 'bulk', rows: [['A', true, 1]] });
    expect(stack).toHaveLength(1);
  });
});

describe('useUndoStack', () => {
  beforeEach(() => useUndoStack.getState().clear());

  it('pops the newest entry first', () => {
    const s = useUndoStack.getState();
    s.push(single(1));
    s.push(single(2));
    expect(useUndoStack.getState().pop()).toEqual(single(2));
    expect(useUndoStack.getState().stack).toEqual([single(1)]);
    expect(useUndoStack.getState().pop()).toEqual(single(1));
    expect(useUndoStack.getState().pop()).toBeUndefined();
  });
});
