import { collect, dispatchSse, type FeatureModule, type WorldCtx } from '../../src/web/app/feature.js';

const Noop = () => null;
const ctx = {} as WorldCtx;

describe('collect', () => {
  it('flattens contributions of all features and sorts them by order', () => {
    const features: FeatureModule[] = [
      { id: 'a', headerItems: [{ id: 'a2', order: 20, Component: Noop }, { id: 'a1', order: 5, Component: Noop }] },
      { id: 'b' },
      { id: 'c', headerItems: [{ id: 'c1', order: 10, Component: Noop }] },
    ];
    expect(collect(features, 'headerItems').map(h => h.id)).toEqual(['a1', 'c1', 'a2']);
  });

  it('keeps routes in feature order', () => {
    const features: FeatureModule[] = [
      { id: 'a', routes: [{ path: '/login' }, { path: '/' }] },
      { id: 'b', routes: [{ path: '/w/:id' }] },
    ];
    expect(collect(features, 'routes').map(r => r.path)).toEqual(['/login', '/', '/w/:id']);
  });

  it('returns an empty list when no feature contributes', () => {
    expect(collect([{ id: 'a' }], 'mapLayers')).toEqual([]);
  });

  it('merges sse handlers so every contributing feature receives the event', () => {
    const calls: string[] = [];
    const features: FeatureModule[] = [
      { id: 'a', sseHandlers: { members: () => calls.push('a') } },
      { id: 'b', sseHandlers: { members: () => calls.push('b'), deleted: () => calls.push('b-deleted') } },
    ];
    const handlers = collect(features, 'sseHandlers');
    handlers.members?.({ type: 'members' }, ctx);
    expect(calls).toEqual(['a', 'b']);
    expect(handlers.mark).toBeUndefined();
  });

  it('keeps calling the other handlers when one throws, and logs the error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    const features: FeatureModule[] = [
      { id: 'a', sseHandlers: { members: () => { throw new Error('broken'); } } },
      { id: 'b', sseHandlers: { members: () => calls.push('b') } },
    ];
    collect(features, 'sseHandlers').members?.({ type: 'members' }, ctx);
    expect(calls).toEqual(['b']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('dispatchSse', () => {
  it('calls the handler for the event type with the event and ctx', () => {
    const mark = vi.fn();
    const deleted = vi.fn();
    const e = { type: 'mark', actor: 'A', collected: true, mismatch: false, by: 1, at: 2, rev: 3 } as const;
    dispatchSse({ mark, deleted }, e, ctx);
    expect(mark).toHaveBeenCalledWith(e, ctx);
    expect(deleted).not.toHaveBeenCalled();
  });

  it('ignores an event nobody handles', () => {
    expect(() => dispatchSse({}, { type: 'deleted' }, ctx)).not.toThrow();
  });
});
