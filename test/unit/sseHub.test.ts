import { SseHub } from '../../src/server/sse/hub.js';

/** A fake stream that collects the `presence` payloads it receives. */
function stream() {
  const got: number[][] = [];
  const write = (chunk: string) => {
    const m = /^event: presence\ndata: (.*)\n\n$/.exec(chunk);
    if (m) got.push((JSON.parse(m[1]!) as { userIds: number[] }).userIds);
  };
  return { got, write, close: () => {} };
}

describe('SseHub presence', () => {
  it('tells every stream of the world who is there whenever someone comes or goes', () => {
    const hub = new SseHub();
    const a = stream();
    const b = stream();
    const other = stream();
    hub.add('w2', 9, other.write, other.close);
    const offA = hub.add('w', 2, a.write, a.close);
    expect(a.got).toEqual([[2]]);
    const offB = hub.add('w', 1, b.write, b.close);
    expect(a.got).toEqual([[2], [1, 2]]);
    expect(b.got).toEqual([[1, 2]]);
    expect(hub.presence('w')).toEqual([1, 2]);
    offA();
    expect(b.got).toEqual([[1, 2], [1]]);
    offB();
    expect(hub.presence('w')).toEqual([]);
    expect(other.got).toEqual([[9]]);
  });

  it('counts a user with two tabs once: a second tab only gets the list, the first tab closing changes nothing', () => {
    const hub = new SseHub();
    const tab1 = stream();
    const tab2 = stream();
    const friend = stream();
    hub.add('w', 3, friend.write, friend.close);
    const off1 = hub.add('w', 1, tab1.write, tab1.close);
    hub.add('w', 1, tab2.write, tab2.close);
    expect(tab2.got).toEqual([[1, 3]]);
    expect(friend.got).toEqual([[3], [1, 3]]);
    off1();
    expect(friend.got).toEqual([[3], [1, 3]]);
    hub.closeUser('w', 1);
    expect(friend.got).toEqual([[3], [1, 3], [3]]);
  });

  it('drops a stream that fails to write without throwing', () => {
    const hub = new SseHub();
    hub.add('w', 1, () => { throw new Error('gone'); }, () => {});
    const b = stream();
    hub.add('w', 2, b.write, b.close);
    expect(hub.presence('w')).toEqual([2]);
    expect(b.got.at(-1)).toEqual([2]);
  });
});
