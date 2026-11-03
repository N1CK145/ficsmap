import { nextStopName } from '../../src/web/features/routes/NextStopButton.js';

const stops = ['a', 'b', 'c', 'd'];
const doneSet = (...names: string[]) => (n: string) => names.includes(n);

describe('nextStopName', () => {
  it('starts with the first unchecked stop when nothing on the route is selected', () => {
    expect(nextStopName(stops, doneSet(), null)).toBe('a');
    expect(nextStopName(stops, doneSet('a'), 'elsewhere')).toBe('b');
  });

  it('walks on from the selected stop even when it is not checked', () => {
    expect(nextStopName(stops, doneSet(), 'a')).toBe('b');
    expect(nextStopName(stops, doneSet(), 'b')).toBe('c');
  });

  it('skips checked stops and wraps around to the start', () => {
    expect(nextStopName(stops, doneSet('c'), 'b')).toBe('d');
    expect(nextStopName(stops, doneSet('a'), 'd')).toBe('b');
  });

  it('stays on the selected stop when it is the only open one, and is undefined when all are done', () => {
    expect(nextStopName(stops, doneSet('a', 'b', 'd'), 'c')).toBe('c');
    expect(nextStopName(stops, doneSet('a', 'b', 'c', 'd'), 'c')).toBeUndefined();
    expect(nextStopName([], doneSet(), null)).toBeUndefined();
  });
});
