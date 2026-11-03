import { lastWorld, loadView, saveView, setLastWorld, type PersistedView } from '../../src/web/app/persist.js';

const view: PersistedView = {
  center: [-1200, 3400], zoom: 3, typeFilter: ['somersloop', 'hard_drive'], visibility: 'hide', biomeScope: 2,
};

describe('persist', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('round-trips the view per world', () => {
    saveView('w1', view);
    expect(loadView('w1')).toEqual(view);
    expect(loadView('w2')).toBeNull();
  });

  it('keeps only valid fields of a stored view', () => {
    saveView('w1', view);
    const key = Object.keys(localStorage).find(k => k.includes('w1'))!;
    localStorage.setItem(key, JSON.stringify({ zoom: 'big', visibility: 'dim', typeFilter: ['somersloop', 'nope'] }));
    expect(loadView('w1')).toEqual({ visibility: 'dim', typeFilter: ['somersloop'] });
  });

  it('returns null for unreadable JSON', () => {
    saveView('w1', view);
    const key = Object.keys(localStorage).find(k => k.includes('w1'))!;
    localStorage.setItem(key, '{not json');
    expect(loadView('w1')).toBeNull();
  });

  it('remembers the last world', () => {
    expect(lastWorld()).toBeNull();
    setLastWorld('w9');
    expect(lastWorld()).toBe('w9');
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveView('w1', view)).not.toThrow();
    expect(() => setLastWorld('w1')).not.toThrow();
    expect(loadView('w1')).toBeNull();
    expect(lastWorld()).toBeNull();
  });
});
