import {
  lastWorld, loadDiagramDirection, loadLocale, loadMarkersVisible, saveMarkersVisible, loadResourceNodeView, saveResourceNodeView, loadPodChecklistCollapsed, loadPodTicks, loadView, saveLocale, savePodChecklistCollapsed, savePodTicks, saveDiagramDirection, saveView,
  setLastWorld, type PersistedView,
} from '../../src/web/app/persist.js';

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

  it('remembers the picked language and ignores unknown values', () => {
    expect(loadLocale()).toBeNull();
    saveLocale('de');
    expect(loadLocale()).toBe('de');
    localStorage.setItem('ficsmap:locale', 'fr');
    expect(loadLocale()).toBeNull();
  });

  it('remembers the pod checklist ticks per world and route, keeping only strings', () => {
    expect(loadPodTicks('w1', 'r1')).toEqual(new Set());
    savePodTicks('w1', 'r1', new Set(['Rotor', 'Motor']));
    expect(loadPodTicks('w1', 'r1')).toEqual(new Set(['Rotor', 'Motor']));
    expect(loadPodTicks('w1', 'r2')).toEqual(new Set());
    expect(loadPodTicks('w2', 'r1')).toEqual(new Set());
    localStorage.setItem('ficsmap:podTicks:w1:r1', JSON.stringify(['Rotor', 3, null]));
    expect(loadPodTicks('w1', 'r1')).toEqual(new Set(['Rotor']));
    localStorage.setItem('ficsmap:podTicks:w1:r1', '{not json');
    expect(loadPodTicks('w1', 'r1')).toEqual(new Set());
  });

  it('forgets the ticks of a route once none are left', () => {
    savePodTicks('w1', 'r1', new Set(['Rotor']));
    savePodTicks('w1', 'r1', new Set());
    expect(localStorage.getItem('ficsmap:podTicks:w1:r1')).toBeNull();
  });

  it('remembers whether the pod checklist was collapsed by hand', () => {
    expect(loadPodChecklistCollapsed()).toBe(false);
    savePodChecklistCollapsed(true);
    expect(loadPodChecklistCollapsed()).toBe(true);
    savePodChecklistCollapsed(false);
    expect(loadPodChecklistCollapsed()).toBe(false);
  });

  it('remembers whether the collectibles layer is shown, shown by default', () => {
    expect(loadMarkersVisible()).toBe(true);
    saveMarkersVisible(false);
    expect(localStorage.getItem('ficsmap:collectibles')).toBe('0');
    expect(loadMarkersVisible()).toBe(false);
    saveMarkersVisible(true);
    expect(loadMarkersVisible()).toBe(true);
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveView('w1', view)).not.toThrow();
    expect(() => setLastWorld('w1')).not.toThrow();
    expect(() => saveMarkersVisible(false)).not.toThrow();
    expect(loadMarkersVisible()).toBe(true);
    expect(() => savePodTicks('w1', 'r1', new Set(['Rotor']))).not.toThrow();
    expect(loadPodTicks('w1', 'r1')).toEqual(new Set());
    expect(loadView('w1')).toBeNull();
    expect(lastWorld()).toBeNull();
  });

  it('remembers the resource node layer and keeps only valid filter values', () => {
    expect(loadResourceNodeView()).toEqual({ visible: false, hiddenResources: [], purities: ['impure', 'normal', 'pure'], occupancy: 'all' });
    saveResourceNodeView({ visible: true, hiddenResources: ['Desc_Coal_C'], purities: ['pure'], occupancy: 'free' });
    expect(loadResourceNodeView()).toEqual({ visible: true, hiddenResources: ['Desc_Coal_C'], purities: ['pure'], occupancy: 'free' });
    localStorage.setItem('ficsmap:resourceNodes', JSON.stringify({ visible: 'yes', hiddenResources: ['A', 3], purities: ['pure', 'shiny', 'impure'], occupancy: 'busy' }));
    expect(loadResourceNodeView()).toEqual({ visible: false, hiddenResources: ['A'], purities: ['impure', 'pure'], occupancy: 'all' });
    localStorage.setItem('ficsmap:resourceNodes', '{not json');
    expect(loadResourceNodeView().purities).toHaveLength(3);
  });
  it('remembers each diagram\'s direction on its own, top to bottom by default', () => {
    expect(loadDiagramDirection('planner')).toBe('down');
    saveDiagramDirection('planner', 'right');
    expect(loadDiagramDirection('planner')).toBe('right');
    expect(loadDiagramDirection('lines')).toBe('down');
    localStorage.setItem('ficsmap:diagramDirection:lines', 'sideways');
    expect(loadDiagramDirection('lines')).toBe('down');
    saveDiagramDirection('planner', 'down');
    expect(localStorage.getItem('ficsmap:diagramDirection:planner')).toBeNull();
  });
});
