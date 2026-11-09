import L from 'leaflet';
import { typeById } from '../../src/shared/collectibleTypes.js';
import { markerVisual } from '../../src/web/features/map/markerStyle.js';
import { MarkerLayer, type DrawMarker } from '../../src/web/features/map/MarkerLayer.js';

const visual = (draw = true) => ({ ...markerVisual('uncollected', {
  visibility: 'dim', zoom: 3, selected: false, inScope: true, typeEnabled: true, onlyConflicts: false, routeIndex: null,
}), draw });
const marker = (id: string, lat: number, lng: number, draw = true): DrawMarker => ({ id, lat, lng, type: typeById('somersloop'), visual: visual(draw) });

describe('MarkerLayer.pick', () => {
  let map: L.Map;
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
    const el = document.createElement('div');
    document.body.append(el);
    // Zoom 1: the 256-unit image is 512 px, so (-128, 128) is the container centre (256, 256).
    map = L.map(el, { crs: L.CRS.Simple, center: [-128, 128], zoom: 1 });
  });
  afterEach(() => {
    map.remove();
    vi.restoreAllMocks();
  });

  it('finds the marker under a container point, projected through the map', () => {
    const layer = new MarkerLayer(() => [marker('centre', -128, 128), marker('left', -128, 64)]).addTo(map);
    expect(layer.pick(260, 254, 16)).toBe('centre');
    expect(layer.pick(128, 256, 16)).toBe('left');
    expect(layer.pick(400, 400, 16)).toBeNull();
  });

  it('skips markers that are not drawn', () => {
    const layer = new MarkerLayer(() => [marker('hidden', -128, 128, false)]).addTo(map);
    expect(layer.pick(256, 256, 16)).toBeNull();
  });

  it('follows the view after a zoom', () => {
    const layer = new MarkerLayer(() => [marker('left', -128, 64)]).addTo(map);
    map.setZoom(2);
    // Zoom 2 doubles the distance from the centre: 64 units left of it are now 256 px left.
    expect(layer.pick(0, 256, 16)).toBe('left');
  });
});

describe('MarkerLayer.setVisible', () => {
  let map: L.Map;
  let drawn: number;
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(512);
    // A 2D context that counts the paths drawn (clearing does not count), and the colour tokens the palette needs.
    drawn = 0;
    const ctx = new Proxy({}, {
      get: (_t, key) => (key === 'beginPath' ? () => { drawn++; } : () => {}),
      set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => '#123456' } as unknown as CSSStyleDeclaration);
    const el = document.createElement('div');
    document.body.append(el);
    map = L.map(el, { crs: L.CRS.Simple, center: [-128, 128], zoom: 1 });
  });
  afterEach(() => {
    map.remove();
    vi.restoreAllMocks();
  });

  it('draws and picks nothing while switched off, and everything again once on', () => {
    const layer = new MarkerLayer(() => [marker('centre', -128, 128)]).addTo(map);
    expect(drawn).toBeGreaterThan(0);
    expect(layer.pick(256, 256, 16)).toBe('centre');

    drawn = 0;
    layer.setVisible(false);
    map.setZoom(2);
    (layer as unknown as { draw(): void }).draw();
    expect(drawn).toBe(0);
    expect(layer.pick(256, 256, 16)).toBeNull();

    layer.setVisible(true);
    expect(drawn).toBeGreaterThan(0);
    expect(layer.pick(256, 256, 16)).toBe('centre');
  });

  it('draws nothing when added while switched off', () => {
    const layer = new MarkerLayer(() => [marker('centre', -128, 128)]).setVisible(false).addTo(map);
    expect(drawn).toBe(0);
    expect(layer.pick(256, 256, 16)).toBeNull();
  });
});
