import { COLLECTIBLE_TYPES } from '../../src/shared/collectibleTypes.js';
import { useUiStore } from '../../src/web/app/store.js';

const ui = () => useUiStore.getState();

describe('ui store', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState(useUiStore.getInitialState(), true);
  });

  it('starts in inspect mode with all types, dimmed collected items and the sidebar open', () => {
    expect(ui().interactionMode).toBe('inspect');
    expect([...ui().typeFilter].sort()).toEqual(COLLECTIBLE_TYPES.map(t => t.id).sort());
    expect(ui().visibility).toBe('dim');
    expect(ui().selectedActor).toBeNull();
    expect(ui().biomeScope).toBeNull();
    expect(ui().sidebarOpen).toBe(true);
    expect(ui().onlyConflicts).toBe(false);
  });

  it('keeps map modes exclusive and returns to inspect when the active mode is set again', () => {
    ui().setMode('route');
    expect(ui().interactionMode).toBe('route');
    ui().setMode('route');
    expect(ui().interactionMode).toBe('inspect');
    ui().setMode('inspect');
    expect(ui().interactionMode).toBe('inspect');
  });

  it('toggles a type in the filter and can show one type only', () => {
    ui().toggleType('somersloop');
    expect(ui().typeFilter.has('somersloop')).toBe(false);
    ui().toggleType('somersloop');
    expect(ui().typeFilter.has('somersloop')).toBe(true);
    ui().showOnlyType('hard_drive');
    expect([...ui().typeFilter]).toEqual(['hard_drive']);
    ui().setTypeFilter(['somersloop', 'mercer_sphere']);
    expect([...ui().typeFilter].sort()).toEqual(['mercer_sphere', 'somersloop']);
  });

  it('replaces the filter set instead of mutating it', () => {
    const before = ui().typeFilter;
    ui().toggleType('somersloop');
    expect(ui().typeFilter).not.toBe(before);
    expect(before.has('somersloop')).toBe(true);
  });

  it('sets selection, visibility, biome scope, sidebar and conflict filter', () => {
    ui().select('BP_WAT1_C_1');
    ui().setVisibility('hide');
    ui().setBiomeScope(3);
    ui().toggleSidebar();
    ui().setOnlyConflicts(true);
    expect(ui()).toMatchObject({
      selectedActor: 'BP_WAT1_C_1', visibility: 'hide', biomeScope: 3, biomeFitRequest: 3, sidebarOpen: false, onlyConflicts: true,
    });
    ui().clearBiomeFitRequest();
    expect(ui()).toMatchObject({ biomeScope: 3, biomeFitRequest: null });
    ui().setSidebarOpen(true);
    expect(ui().sidebarOpen).toBe(true);
  });

  it('switches the collectibles layer and remembers it on the device', () => {
    expect(ui().markersVisible).toBe(true);
    ui().toggleMarkers();
    expect(ui().markersVisible).toBe(false);
    expect(localStorage.getItem('ficsmap:collectibles')).toBe('0');
    ui().showMarkers();
    expect(ui().markersVisible).toBe(true);
    expect(localStorage.getItem('ficsmap:collectibles')).toBe('1');
  });

  it('shows the collectibles layer for what is about a marker: a selection, focusItem, the route mode', () => {
    const off = () => { ui().toggleMarkers(); expect(ui().markersVisible).toBe(false); };
    off();
    ui().select(null);
    ui().setMode('vehicle-route');
    ui().setMode('inspect');
    expect(ui().markersVisible).toBe(false);
    ui().select('BP_WAT1_C_1');
    expect(ui().markersVisible).toBe(true);
    off();
    ui().focusItem('BP_WAT1_C_1');
    expect(ui().markersVisible).toBe(true);
    off();
    ui().setMode('route');
    expect(ui().markersVisible).toBe(true);
    // Leaving the route mode leaves the layer as it is.
    off();
    ui().setMode('route');
    expect(ui()).toMatchObject({ interactionMode: 'inspect', markersVisible: false });
  });

  it('enterWorld resets per-world state and applies the persisted view', () => {
    ui().setMode('route');
    ui().select('BP_WAT1_C_1');
    ui().setOnlyConflicts(true);
    ui().setBiomeScope(4);
    ui().setVisibility('show');
    ui().showOnlyType('somersloop');
    ui().setSidebarOpen(false);
    ui().toggleMarkers();

    ui().enterWorld('world-a', { typeFilter: ['hard_drive', 'mercer_sphere'], visibility: 'hide', biomeScope: 2, zoom: 3 });
    expect(ui()).toMatchObject({
      worldId: 'world-a', interactionMode: 'inspect', selectedActor: null, onlyConflicts: false, visibility: 'hide', biomeScope: 2, biomeFitRequest: null,
      sidebarOpen: false, markersVisible: false,
    });
    expect([...ui().typeFilter].sort()).toEqual(['hard_drive', 'mercer_sphere']);

    ui().enterWorld('world-b');
    expect(ui()).toMatchObject({ worldId: 'world-b', visibility: 'dim', biomeScope: null });
    expect(ui().typeFilter.size).toBe(COLLECTIBLE_TYPES.length);
  });
});
