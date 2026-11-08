import { gzipSync } from 'node:zlib';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { worldToLatLng } from '../../src/shared/geo.js';
import { encodeHeightTile, type HeightmapMeta } from '../../src/shared/heightmap.js';
import type { TransportData } from '../../src/shared/transport.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import { PICK_MODE, pickRouteMode, vehicleCalcFeature, vehicleCalcTool } from '../../src/web/features/vehicleCalc/index.js';
import { PickReturn } from '../../src/web/features/vehicleCalc/PickReturn.js';
import { EMPTY_FORM, useVehicleCalc } from '../../src/web/features/vehicleCalc/useVehicleCalc.js';
import { ROUTE_PANE, VehicleRouteLayer } from '../../src/web/features/vehicleCalc/VehicleRouteLayer.js';
import { MarkerLayer } from '../../src/web/features/map/MarkerLayer.js';
import { findItem, VEHICLE_PICTURES } from '../../src/web/features/vehicleCalc/VehicleCalculator.js';
import { stubFetch } from './fetchStub.js';
import { renderWorldPages } from './worldPages.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }], items: [['S1', 'somersloop', 30_000, 10_000, 0, 0, 1]], aliases: {},
};
const AUTOPILOT = { source: 'autopilot', perMetreMJ: 5, perTripMJ: 0, fuels: null } as const;
const DATA: TransportData = {
  gameVersion: '1.2.5.0',
  vehicles: [
    { id: 'tractor', name: { en: 'Tractor', de: 'Schlepper' }, slots: 25, fluidCapacity: null, stopSeconds: 16, stopSource: 'truckStation', straightPathSpeed: 25, tractionSpeed: 19.6, fuel: AUTOPILOT },
    { id: 'truck', name: { en: 'Truck', de: 'Lkw' }, slots: 48, fluidCapacity: null, stopSeconds: 16, stopSource: 'truckStation', straightPathSpeed: 25, tractionSpeed: 26.2, fuel: AUTOPILOT },
    { id: 'fluidTruck', name: { en: 'Fluid Truck', de: 'Tanklaster' }, slots: null, fluidCapacity: 3200, stopSeconds: 18, stopSource: 'fluidTruckStation', straightPathSpeed: 25, tractionSpeed: 26.2, fuel: AUTOPILOT },
    {
      id: 'drone', name: { en: 'Drone', de: 'Drohne' }, slots: 9, fluidCapacity: null, stopSeconds: 102, stopSource: 'dronePort', straightPathSpeed: null, tractionSpeed: null,
      fuel: { source: 'dronePort', perMetreMJ: 6, perTripMJ: 24_000, fuels: [{ id: 'Desc_Battery_C', speed: 75 }, { id: 'Desc_Fuel_C', speed: 50 }] },
    },
    { id: 'freightCar', name: { en: 'Freight Car', de: 'Güterwagen' }, slots: 32, fluidCapacity: 2400, stopSeconds: 54, stopSource: 'freightPlatform', straightPathSpeed: null, tractionSpeed: null, fuel: null },
  ],
  items: [
    { id: 'Desc_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, stackSize: 200, fluid: false },
    { id: 'Desc_Water_C', name: { en: 'Water', de: 'Wasser' }, stackSize: 50_000, fluid: true },
  ],
  fuels: [
    { id: 'Desc_Coal_C', name: { en: 'Coal', de: 'Kohle' }, energyMJ: 300 },
    { id: 'Desc_Fuel_C', name: { en: 'Packaged Fuel', de: 'Abgefüllter Treibstoff' }, energyMJ: 750 },
    { id: 'Desc_Battery_C', name: { en: 'Battery', de: 'Batterie' }, energyMJ: 6000 },
  ],
};

function setup(data: 'present' | 'missing') {
  const { calls } = stubFetch(data === 'present' ? { 'GET /data/test/transport.json': { body: DATA } } : {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const { router } = renderWorldPages({ features: [vehicleCalcFeature], ctx, url: `/w/${W}` });
  return { calls, router };
}

const user = () => userEvent.setup();

async function open() {
  await user().click(screen.getByRole('link', { name: 'Vehicles' }));
  return screen.findByRole('main', { name: 'Vehicle calculator' });
}

/** The result: what one vehicle does on the route. */
const result = (name = 'Result') => screen.getByRole('status', { name });
/** A figure of the result by its label: its value and the line under it, joined by " | ". */
function stat(label: string, name = 'Result'): string {
  const dt = within(result(name)).getByText(label, { selector: 'dt' });
  return [...dt.parentElement!.querySelectorAll('dd')].map(d => d.textContent).join(' | ');
}
/** Opens a folded section by its summary. */
const unfold = (text: RegExp | string) => user().click(screen.getByText(text, { selector: 'summary, summary *' }));

describe('vehicle calculator', () => {
  beforeEach(() => {
    initI18n(['en']);
    useVehicleCalc.setState({ form: EMPTY_FORM });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a tool that leads to its own page, /w/:id/vehicles', () => {
    expect(vehicleCalcFeature.tools).toEqual([vehicleCalcTool]);
    expect(vehicleCalcTool).toMatchObject({ action: true, page: 'vehicles' });
    expect(vehicleCalcFeature.pages?.map(p => [p.id, p.titleKey])).toEqual([['vehicles', 'vehicleCalc.title']]);
    expect(vehicleCalcFeature.headerItems).toBeUndefined();
    expect(vehicleCalcTool.icon).toBeDefined();
  });

  it('leads through route, vehicle and fuel, and answers with one truck on the route', async () => {
    const { calls, router } = setup('present');
    expect(calls).toEqual([]);
    const page = await open();
    expect(router.state.location.pathname).toBe(`/w/${W}/vehicles`);
    expect(screen.getByRole('link', { name: 'Vehicles' })).toHaveAttribute('aria-current', 'page');
    const route = await within(page).findByLabelText('Route length (one way)');
    // The vehicle data, and the game's pictures (none in this dataset).
    expect(calls.map(c => c.path).sort()).toEqual(['/data/test/icons/items/index.json', '/data/test/transport.json']);

    // Three numbered steps, then the result, each a window named by its title; the number stands before the title.
    expect(within(page).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Route', 'Vehicle', 'Fuel', 'Result']);
    expect(within(page).getByRole('region', { name: 'Route' }).querySelector('[aria-hidden="true"]')).toHaveTextContent('1');
    // The vehicles as cards, the Truck chosen; each says what it carries.
    const vehicles = within(page).getByRole('radiogroup', { name: 'Vehicle' });
    expect(within(vehicles).getAllByRole('radio').map(r => r.getAttribute('value'))).toEqual(['tractor', 'truck', 'fluidTruck', 'drone', 'freightCar']);
    expect(within(vehicles).getByRole('radio', { name: 'Truck' })).toBeChecked();
    expect(within(vehicles).getByRole('radio', { name: 'Truck' })).toHaveAccessibleDescription('48 stacks');
    expect(within(vehicles).getByRole('radio', { name: 'Freight Car' })).toHaveAccessibleDescription('32 stacks or 2,400 m³');
    expect(within(page).getByRole('combobox', { name: 'Fuel' })).toHaveValue('Desc_Fuel_C');
    // Until the route is known the result says what is missing.
    expect(result()).toHaveTextContent('Pick the route on the map or type its length to see the result.');
    expect(within(page).queryByRole('table')).toBeNull();

    const u = user();
    // 1800 m at 90 km/h: 144 s there and back + 16 s = 160 s; 48 stacks per trip = 18 stacks/min per truck
    await u.type(route, '1800');
    expect(result()).toHaveTextContent(/^Truck1,800 mPackaged Fuel/);
    expect(stat('Per vehicle')).toBe('18 stacks/min');
    expect(stat('Round trip')).toBe('2 min 40 s | 1 min 12 s one way');
    // 2 x 1800 m x 5 MJ = 18 000 MJ = 24 Packaged Fuel per round trip of 160 s, 9 per minute
    expect(stat('Fuel per round trip')).toBe('24 | 9 per minute');
    expect(result()).toHaveTextContent('Load per trip: 48 stacks · includes 16 s loading and unloading');
    expect(result()).toHaveTextContent('Fuel is an estimate');

    // Every fuel compared: the trip takes as long with each, so only the fuel differs; least used first.
    const table = within(page).getByRole('table', { name: 'All fuels compared' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(r => [within(r).getByRole('rowheader').textContent, ...within(r).getAllByRole('cell').map(c => c.textContent)])).toEqual([
      ['Battery', '3', '1.13'], ['Packaged Fuel', '24', '9'], ['Coal', '60', '22.5'],
    ]);
    expect(within(table).getByRole('row', { current: true })).toHaveTextContent('Packaged Fuel');
    await u.selectOptions(within(page).getByRole('combobox', { name: 'Fuel' }), 'Desc_Coal_C');
    expect(stat('Fuel per round trip')).toBe('60 | 22.5 per minute');
    expect(within(table).getByRole('row', { current: true })).toHaveTextContent('Coal');
  });

  it('answers how many vehicles a target needs, folded away until asked', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.type(await within(page).findByLabelText('Route length (one way)'), '1800');
    const fleet = within(page).getByText('How many vehicles do I need?', { selector: 'summary *' }).closest('details')!;
    expect(fleet).not.toHaveAttribute('open');
    await unfold('How many vehicles do I need?');
    expect(fleet).toHaveAttribute('open');
    expect(within(fleet).getByText('stacks/min')).toBeInTheDocument();
    expect(result('How many vehicles do I need?')).toHaveTextContent('Enter a target throughput.');
    await u.type(within(fleet).getByLabelText('Target throughput'), '40');
    const answer = result('How many vehicles do I need?');
    expect(answer).toHaveTextContent('Vehicles needed3');
    expect(answer).toHaveTextContent('Utilisation74%');
    expect(answer).toHaveTextContent('They move up to54 stacks/min');
    expect(answer).toHaveTextContent('Fuel for all27 Packaged Fuel/min');
  });

  it('keeps speed and stop time under more settings, with the game values and a way back to them', async () => {
    setup('present');
    const page = await open();
    const u = user();
    const more = (await within(page).findByText('More settings')).closest('details')!;
    expect(more).not.toHaveAttribute('open');
    // The folded section says which values are in effect.
    expect(more.querySelector('summary')).toHaveTextContent('More settingsany item · 90 km/h · 16 s');
    await unfold('More settings');
    const speed = within(more).getByLabelText('Average speed');
    expect(speed).toHaveValue(90);
    // The unit, then the hint.
    expect(speed).toHaveAccessibleDescription("km/h Game value: the autopilot's limit on a straight road. The real average is lower (curves, slopes).");
    const stop = within(more).getByLabelText('Load and unload time');
    expect(stop).toHaveValue(16);
    expect(stop).toHaveAccessibleDescription('s Both ends together. Game value: one Truck Station cycle at each end.');
    expect(within(more).queryByRole('button', { name: /game value/ })).toBeNull();

    await u.type(within(page).getByLabelText('Route length (one way)'), '1800');
    await u.clear(speed);
    await u.type(speed, '45');
    // At half the speed: 288 s driving + 16 s.
    expect(stat('Round trip')).toBe('5 min 4 s | 2 min 24 s one way');
    expect(more.querySelector('summary')).toHaveTextContent('any item · 45 km/h · 16 s');
    await u.click(within(more).getByRole('button', { name: 'Use the game value (90 km/h)' }));
    expect(speed).toHaveValue(90);
    expect(stat('Round trip')).toBe('2 min 40 s | 1 min 12 s one way');
    expect(within(more).queryByRole('button', { name: /game value/ })).toBeNull();
  });

  it("defaults the Tractor's speed to where its tractive effort ends and the Fluid Truck's stop to its station", async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.click(await within(page).findByRole('radio', { name: 'Tractor' }));
    // 19.6 m/s, below the straight-path limit of 25 m/s (90 km/h)
    expect(within(page).getByLabelText('Average speed')).toHaveValue(70.6);
    expect(within(page).getByLabelText('Average speed')).toHaveAccessibleDescription(/where the engine's pull ends; the autopilot's limit of 90 km\/h/);
    await u.click(within(page).getByRole('radio', { name: 'Fluid Truck' }));
    expect(within(page).getByLabelText('Average speed')).toHaveValue(90);
    expect(within(page).getByLabelText('Load and unload time')).toHaveValue(18);
    expect(within(page).getByLabelText('Load and unload time')).toHaveAccessibleDescription(/one Fluid Truck Station cycle at each end/);
    // Without an item the Fluid Truck carries m³.
    await u.type(within(page).getByLabelText('Route length (one way)'), '1800');
    // 160 s + 2 s more at the station: 3200 m³ per 162 s
    expect(stat('Per vehicle')).toBe('1,185.2 m³/min');
  });

  it('offers the drone its own fuels, with the speed and trip cost of the chosen one', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.click(await within(page).findByRole('radio', { name: 'Drone' }));
    const fuel = within(page).getByRole('combobox', { name: 'Fuel' });
    expect(within(fuel).getAllByRole('option').map(o => o.textContent)).toEqual(['Battery', 'Packaged Fuel']);
    expect(fuel).toHaveValue('Desc_Fuel_C');
    expect(fuel).toHaveAccessibleDescription("The drone's speed depends on its fuel.");
    expect(within(page).getByLabelText('Average speed')).toHaveValue(180);
    expect(within(page).getByLabelText('Average speed')).toHaveAccessibleDescription('km/h Game value for this fuel (Packaged Fuel).');
    await u.type(within(page).getByLabelText('Route length (one way)'), '1000');
    // 2 x 1000 m at 50 m/s = 40 s + 102 s; 24 000 + 12 000 MJ = 48 Packaged Fuel per round trip of 142 s
    expect(stat('Round trip')).toBe('2 min 22 s | 20 s one way');
    expect(stat('Fuel per round trip')).toBe('48 | 20.28 per minute');
    expect(stat('Per vehicle')).toBe('3.8 stacks/min');
    expect(result()).toHaveTextContent('Drone fuel use as measured by players.');
    await u.selectOptions(fuel, 'Desc_Battery_C');
    expect(within(page).getByLabelText('Average speed')).toHaveValue(270);
    expect(stat('Fuel per round trip')).toBe('6 | 2.8 per minute');
    // The wheeled vehicles keep their own fuel.
    await u.click(within(page).getByRole('radio', { name: 'Truck' }));
    expect(within(page).getByRole('combobox', { name: 'Fuel' })).toHaveValue('Desc_Fuel_C');
  });

  it('gives items and stacks per minute for an item', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.type(await within(page).findByLabelText('Route length (one way)'), '1800');
    await unfold('More settings');
    await u.type(within(page).getByLabelText('Item (optional)'), 'iron plate');
    // One truck: 18 stacks of 200 plates a minute.
    expect(stat('Per vehicle')).toBe('18 stacks/min | 3,600 items/min');
    expect(result()).toHaveTextContent('Load per trip: 9,600 items');
    await unfold('How many vehicles do I need?');
    await u.type(within(page).getByLabelText('Target throughput'), '7200');
    expect(result('How many vehicles do I need?')).toHaveTextContent('They move up to7,200 items/min (36 stacks/min)');
  });

  it('asks for the speed where the game data has none, and gives fluids in m³', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.click(await within(page).findByRole('radio', { name: 'Freight Car' }));
    // Needed for any result, so not folded away under more settings.
    const speed = within(page).getByLabelText('Average speed');
    expect(speed.closest('details')).toBeNull();
    expect(speed).toHaveValue(null);
    expect(speed).toHaveAccessibleDescription(/Not in the game data/);
    expect(within(page).getByText('Freight cars burn no fuel: trains run on power.')).toBeInTheDocument();
    expect(within(page).queryByRole('combobox', { name: 'Fuel' })).toBeNull();
    await u.type(within(page).getByLabelText('Route length (one way)'), '3000');
    expect(result()).toHaveTextContent('Enter the average speed to see the result.');
    await u.type(speed, '120');
    await unfold('More settings');
    await u.type(within(page).getByLabelText('Item (optional)'), 'Water');
    // 2 x 90 s + 54 s = 234 s per round trip; 2400 m³ per trip
    expect(stat('Per freight car')).toBe('615.4 m³/min');
    expect(stat('Round trip')).toBe('3 min 54 s | 1 min 30 s one way');
    expect(result()).not.toHaveTextContent('Fuel');
    expect(within(page).queryByRole('table')).toBeNull();
    await unfold('How many freight cars do I need?');
    await u.type(within(page).getByLabelText('Target throughput'), '1000');
    const fleet = within(page).getByText('How many freight cars do I need?', { selector: 'summary *' }).closest('details')!;
    expect(within(fleet).getByText('m³/min')).toBeInTheDocument();
    expect(result('How many freight cars do I need?')).toHaveTextContent('Freight cars needed2');
    expect(within(page).getByText(/Counts freight cars/)).toBeInTheDocument();
  });

  it('says when the vehicle cannot carry the item', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.type(await within(page).findByLabelText('Route length (one way)'), '1800');
    await unfold('More settings');
    await u.type(within(page).getByLabelText('Item (optional)'), 'Water');
    expect(within(page).getByLabelText('Item (optional)')).toHaveAccessibleDescription('Truck cannot carry Water.');
    expect(within(page).getByLabelText('Item (optional)')).toBeInvalid();
    expect(result()).toHaveTextContent('Truck cannot carry Water.');
    await u.click(within(page).getByRole('button', { name: 'Clear item' }));
    expect(stat('Per vehicle')).toBe('18 stacks/min');
  });

  it('keeps the form when the page is left and works in German', async () => {
    initI18n(['de']);
    setup('present');
    await user().click(screen.getByRole('link', { name: 'Fahrzeuge' }));
    const page = await screen.findByRole('main', { name: 'Fahrzeug-Rechner' });
    await user().type(await within(page).findByLabelText('Streckenlänge (einfach)'), '1800');
    await unfold('Weitere Einstellungen');
    await user().type(within(page).getByLabelText('Gegenstand (optional)'), 'Eisenplatte');
    expect(useVehicleCalc.getState().form.item).toBe('Eisenplatte');
    expect(stat('Pro Fahrzeug', 'Ergebnis')).toBe('18 Stapel/min | 3.600 Stück/min');
    expect(stat('Hin und zurück', 'Ergebnis')).toBe('2 min 40 s | Hinweg 1 min 12 s');
    await user().click(within(page).getByRole('link', { name: 'Zurück zur Karte' }));
    expect(screen.queryByRole('main')).toBeNull();
    await user().click(screen.getByRole('link', { name: 'Fahrzeuge' }));
    // Back again: the item is kept, and its section is open.
    expect(await screen.findByLabelText('Gegenstand (optional)')).toHaveValue('Eisenplatte');
    expect(screen.getByText('Weitere Einstellungen').closest('details')).toHaveAttribute('open');
  });

  it('shows a notice for a dataset without vehicle data', async () => {
    setup('missing');
    const page = await open();
    expect(await within(page).findByText(/has no vehicle data/)).toBeInTheDocument();
  });

  it('matches items by name in the current language or English', () => {
    expect(findItem(DATA.items, ' eisenplatte ', 'de')?.id).toBe('Desc_IronPlate_C');
    expect(findItem(DATA.items, 'Water', 'de')?.id).toBe('Desc_Water_C');
    expect(findItem(DATA.items, 'Wat', 'en')).toBeNull();
    expect(findItem(DATA.items, '', 'en')).toBeNull();
  });

  it('names a picture for every vehicle', () => {
    for (const v of DATA.vehicles) expect(VEHICLE_PICTURES[v.id]).toMatch(/^Desc_\w+_C$/);
  });
});

// Height map as in Coords.test: one 2 x 2 tile of 250 m cells. (300 m, 100 m) is 45.7 m high, (300 m, 300 m) -12.3 m.
const META: HeightmapMeta = { cell: 25_000, minX: 0, minY: 0, width: 4, height: 4, tile: 2, step: 10, id: 'abc', overview: { factor: 2, width: 2, height: 2 }, range: [-1000, 5000] };

/** The vehicle data and, with `heights`, the height map; everything else is a 404. */
function stubData(heights: boolean) {
  const tile = gzipSync(Buffer.from(encodeHeightTile([4560, 4570, Number.NaN, -1230], 10).buffer));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/data/test/transport.json') return json(DATA);
    if (heights && path === '/data/test/height/meta.json') return json(META);
    if (heights && path === '/data/test/height/0_0.bin.gz') return new Response(tile);
    return json({ error: 'not_found', message: 'no' }, 404);
  }));
}

/**
 * The calculator page and its tool; on the world's own URL a stand-in for the map with what MapView shows of this
 * feature: the mode's banner while the pick mode is on, and the layer that goes back to the calculator.
 */
function setupPicking(heights = false) {
  stubData(heights);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
  const Banner = pickRouteMode.Banner!;
  function MapStub() {
    const picking = useUiStore(s => s.interactionMode) === PICK_MODE;
    return <>{picking && <Banner />}<PickReturn ctx={ctx} /></>;
  }
  const { router } = renderWorldPages({ features: [vehicleCalcFeature], ctx, url: `/w/${W}`, map: <MapStub /> });
  return {
    ctx,
    router,
    clickMap: (x: number, y: number) => act(() => pickRouteMode.onMapClick!({ x, y }, ctx)),
    clickMarker: (name: string) => act(() => pickRouteMode.onMarkerClick(ctx.index.byName.get(name)!, ctx)),
  };
}

const calculator = () => screen.findByRole('main', { name: 'Fahrzeug-Rechner' });

async function openDe() {
  await user().click(screen.getByRole('link', { name: 'Fahrzeuge' }));
  const page = await calculator();
  await within(page).findByLabelText('Streckenlänge (einfach)');
  return page;
}

const routeInput = () => screen.getByLabelText('Streckenlänge (einfach)');
const routeInfo = () => screen.getByRole('region', { name: 'Strecke auf der Karte' });

describe('vehicle calculator: route on the map', () => {
  beforeEach(() => {
    initI18n(['de']);
    useUiStore.getState().enterWorld(W);
    useVehicleCalc.setState({ form: EMPTY_FORM, route: null, pickedStart: null, lengthFromRoute: false, returnRequest: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a map mode that takes points anywhere, with a banner, and map layers', () => {
    expect(vehicleCalcFeature.mapModes).toEqual([pickRouteMode]);
    expect(pickRouteMode.id).toBe('vehicle-route');
    expect(pickRouteMode.onMapClick).toBeTypeOf('function');
    expect(vehicleCalcFeature.mapLayers?.map(l => l.id)).toEqual(['vehicle-route', 'vehicle-pick-return']);
  });

  it('picks start and destination on the map, then goes back to the calculator with the route and one truck on it', async () => {
    const { clickMap, clickMarker, router } = setupPicking(true);
    useUiStore.getState().setMainView('list');
    const page = await openDe();
    expect(within(page).getByText('Start (A) und Ziel (B) auf der Karte wählen oder die Länge eintippen.')).toBeInTheDocument();
    await user().click(within(page).getByRole('button', { name: 'Auf der Karte wählen' }));

    // The page gives way to the map (also from the list view); the banner says what to pick.
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(useUiStore.getState().mainView).toBe('map');
    expect(useUiStore.getState().interactionMode).toBe('vehicle-route');
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Streckenlänge (einfach)')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Fahrzeug-Rechner: Start auf der Karte wählen');
    clickMap(30_000, 30_000);
    expect(screen.getByRole('status')).toHaveTextContent('Fahrzeug-Rechner: jetzt das Ziel wählen');
    expect(useVehicleCalc.getState().pickedStart).toEqual({ x: 30_000, y: 30_000 });
    // The destination is a marker: its position counts. 200 m north.
    clickMarker('S1');

    expect(useUiStore.getState().interactionMode).toBe('inspect');
    expect(await calculator()).toBeInTheDocument();
    // A step back: the map entry of the pick is ahead in the history, Back leads where it led before.
    expect(router.state.location.pathname).toBe(`/w/${W}/vehicles`);
    expect(router.state.historyAction).toBe('POP');
    expect(useVehicleCalc.getState().returnRequest).toBe(false);
    expect(useVehicleCalc.getState().route).toEqual({ start: { x: 30_000, y: 30_000 }, end: { x: 30_000, y: 10_000 } });
    expect(routeInput()).toHaveValue(200);
    expect(routeInfo()).toHaveTextContent('Luftlinie200 m');
    // From -12.3 m up to 45.7 m.
    await waitFor(() => expect(routeInfo()).toHaveTextContent('Höhenunterschied A → B+58 m'));
    expect(routeInfo()).toHaveTextContent('3D-Länge208 m');
    expect(routeInfo()).toHaveTextContent('Für Drohnen genau. Straßen sind länger');

    // One truck on 200 m at 90 km/h: 8 s one way, 16 s there and back plus 16 s at the stations, 48 stacks a trip.
    expect(screen.getByRole('status', { name: 'Ergebnis' })).toHaveTextContent(/^Lkw200 mAbgefüllter Treibstoff/);
    expect(stat('Pro Fahrzeug', 'Ergebnis')).toBe('90 Stapel/min');
    expect(stat('Hin und zurück', 'Ergebnis')).toBe('32 s | Hinweg 8 s');
    // 2 x 200 m x 5 MJ = 2000 MJ = 2.67 Packaged Fuel per round trip.
    expect(stat('Treibstoff hin und zurück', 'Ergebnis')).toBe('2,67 | 5 pro Minute');
  });

  it('follows moved points until the length is typed, and can take the straight line again', async () => {
    setupPicking();
    useVehicleCalc.setState({ route: { start: { x: 0, y: 0 }, end: { x: 10_000, y: 0 } }, lengthFromRoute: true, form: { ...EMPTY_FORM, route: '100' } });
    const page = await openDe();
    // No height map: no height rows.
    expect(routeInfo()).toHaveTextContent('Luftlinie100 m');
    expect(routeInfo()).not.toHaveTextContent('Höhenunterschied');
    act(() => useVehicleCalc.getState().moveRoutePoint('end', { x: 30_000, y: 40_000 }));
    expect(routeInput()).toHaveValue(500);

    const u = user();
    await u.clear(routeInput());
    await u.type(routeInput(), '650');
    expect(routeInfo()).toHaveTextContent('Die Länge ist eingetippt');
    act(() => useVehicleCalc.getState().moveRoutePoint('end', { x: 60_000, y: 80_000 }));
    expect(routeInput()).toHaveValue(650);
    expect(routeInfo()).toHaveTextContent('Luftlinie1.000 m');
    await u.click(within(page).getByRole('button', { name: 'Luftlinie übernehmen' }));
    expect(routeInput()).toHaveValue(1000);
    expect(routeInfo()).not.toHaveTextContent('Die Länge ist eingetippt');

    // Clearing the points keeps the length.
    await u.click(within(page).getByRole('button', { name: 'Punkte entfernen' }));
    expect(screen.queryByRole('region', { name: 'Strecke auf der Karte' })).toBeNull();
    expect(within(page).getByRole('button', { name: 'Auf der Karte wählen' })).toBeInTheDocument();
    expect(routeInput()).toHaveValue(1000);
    expect(useVehicleCalc.getState().route).toBeNull();
  });

  it('cancels with Esc or the banner button, keeping the route it had', async () => {
    const { clickMap, router } = setupPicking();
    const before = { start: { x: 0, y: 0 }, end: { x: 10_000, y: 0 } };
    useVehicleCalc.setState({ route: before, lengthFromRoute: true, form: { ...EMPTY_FORM, route: '100' } });
    let page = await openDe();
    await user().click(within(page).getByRole('button', { name: 'Neu wählen' }));
    clickMap(50_000, 50_000);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    page = await calculator();
    expect(router.state.location.pathname).toBe(`/w/${W}/vehicles`);
    expect(useVehicleCalc.getState().route).toEqual(before);
    expect(routeInput()).toHaveValue(100);

    await user().click(within(page).getByRole('button', { name: 'Neu wählen' }));
    // A new pick starts with the start again.
    expect(screen.getByRole('status')).toHaveTextContent('Start auf der Karte wählen');
    const cancel = screen.getByRole('button', { name: 'Abbrechen' });
    expect(cancel).toHaveAttribute('aria-keyshortcuts', 'Escape');
    await user().click(cancel);
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    expect(await calculator()).toBeInTheDocument();
    expect(useVehicleCalc.getState().route).toEqual(before);
  });

  it('ends picking when the calculator page is opened again (tool or Back), and stays on the map when another mode takes over', async () => {
    const { router, clickMap } = setupPicking();
    let page = await openDe();
    await user().click(within(page).getByRole('button', { name: 'Auf der Karte wählen' }));
    expect(screen.queryByLabelText('Streckenlänge (einfach)')).toBeNull();
    await user().click(screen.getByRole('link', { name: 'Fahrzeuge' }));
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    expect(await screen.findByLabelText('Streckenlänge (einfach)')).toBeInTheDocument();

    page = await calculator();
    await user().click(within(page).getByRole('button', { name: 'Auf der Karte wählen' }));
    clickMap(10_000, 10_000);
    await act(() => router.navigate(-1));
    expect(useUiStore.getState().interactionMode).toBe('inspect');
    expect(await screen.findByLabelText('Streckenlänge (einfach)')).toBeInTheDocument();
    expect(useVehicleCalc.getState().route).toBeNull();

    page = await calculator();
    await user().click(within(page).getByRole('button', { name: 'Auf der Karte wählen' }));
    act(() => useUiStore.getState().setMode('route'));
    expect(useUiStore.getState().interactionMode).toBe('route');
    expect(router.state.location.pathname).toBe(`/w/${W}`);
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('comes back to the calculator with a new history entry when the map was reached another way meanwhile', async () => {
    const { router, clickMap } = setupPicking();
    const page = await openDe();
    await user().click(within(page).getByRole('button', { name: 'Auf der Karte wählen' }));
    // Picking goes on after a detour: the map is now a plain entry.
    await act(() => router.navigate(`/w/${W}`));
    clickMap(0, 0);
    clickMap(10_000, 0);
    expect(await calculator()).toBeInTheDocument();
    expect(router.state.historyAction).toBe('PUSH');
    expect(useVehicleCalc.getState().route).toEqual({ start: { x: 0, y: 0 }, end: { x: 10_000, y: 0 } });
  });

  it('compares the drone with every fuel, the selected one marked, because its speed depends on the fuel', async () => {
    setupPicking();
    const page = await openDe();
    const u = user();
    await u.click(within(page).getByRole('radio', { name: 'Drohne' }));
    await u.type(routeInput(), '1000');
    const table = within(page).getByRole('table', { name: 'Alle Treibstoffe im Vergleich' });
    expect(within(page).getByText('Schnellster zuerst. Verbrauch: Treibstoff pro Fahrt hin und zurück.')).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Treibstoff', 'Hin und zurück', 'Verbrauch', 'Stapel/min']);
    const rows = within(table).getAllByRole('row').slice(1);
    // Fastest first. Battery: 75 m/s, 128.7 s round trip, 6 Batteries, 9 stacks = 4.2 stacks/min. All of it, nothing cut.
    expect(rows.map(r => within(r).getByRole('rowheader').textContent)).toEqual(['Batterie', 'Abgefüllter Treibstoff']);
    expect(within(rows[0]!).getAllByRole('cell').map(c => c.textContent)).toEqual(['2 min 9 s', '6', '4,2']);
    expect(within(rows[1]!).getAllByRole('cell').map(c => c.textContent)).toEqual(['2 min 22 s', '48', '3,8']);
    expect(within(table).getByRole('row', { current: true })).toHaveTextContent('Abgefüllter Treibstoff');
    expect(stat('Hin und zurück', 'Ergebnis')).toBe('2 min 22 s | Hinweg 20 s');

    await u.selectOptions(within(page).getByRole('combobox', { name: 'Treibstoff' }), 'Desc_Battery_C');
    expect(within(table).getByRole('row', { current: true })).toHaveTextContent('Batterie');
    expect(stat('Hin und zurück', 'Ergebnis')).toBe('2 min 9 s | Hinweg 13,3 s');
  });
});

describe('vehicle route layer', () => {
  beforeEach(() => {
    initI18n(['de']);
    useUiStore.getState().enterWorld(W);
    useVehicleCalc.setState({ form: EMPTY_FORM, route: null, pickedStart: null, lengthFromRoute: false });
  });

  function renderLayer() {
    const client = new QueryClient();
    const ctx: WorldCtx = { worldId: W, world: WORLD, me: ME, index: indexDataset(DS), queryClient: client, navigate: () => {}, toast: { show: () => {} } };
    let map: L.Map | undefined;
    const Grab = () => { map = useMap(); return null; };
    const { container } = render(
      <MapContainer crs={L.CRS.Simple} center={[-128, 128]} zoom={1} style={{ width: 400, height: 400 }}>
        <Grab />
        <VehicleRouteLayer ctx={ctx} />
      </MapContainer>,
    );
    const pins = () => [...container.querySelectorAll('.ficsmap-vroute-pin')].map(p => [p.textContent, p.getAttribute('title')]);
    const markers = () => {
      const out: L.Marker[] = [];
      map!.eachLayer(l => { if (l instanceof L.Marker) out.push(l); });
      return out;
    };
    return { container, pins, markers, map: () => map! };
  }

  it('shows A and B with the line while the route is set, and drags them', () => {
    const { container, pins, markers } = renderLayer();
    expect(pins()).toEqual([]);
    act(() => useVehicleCalc.setState({ route: { start: { x: 0, y: 0 }, end: { x: 30_000, y: 40_000 } }, lengthFromRoute: true, form: { ...EMPTY_FORM, route: '500' } }));
    expect(pins()).toEqual([['A', 'Start'], ['B', 'Ziel']]);
    // The line and its dark casing, in a pane of their own.
    expect(container.querySelectorAll(`.leaflet-${ROUTE_PANE}-pane path`)).toHaveLength(2);

    // Dragging B moves the destination; the length follows.
    const b = markers().find(m => m.options.title === 'Ziel')!;
    act(() => {
      b.setLatLng(worldToLatLng(60_000, 80_000, DS.bounds));
      b.fire('drag');
    });
    expect(useVehicleCalc.getState().route?.end.x).toBeCloseTo(60_000);
    expect(useVehicleCalc.getState().route?.end.y).toBeCloseTo(80_000);
    expect(useVehicleCalc.getState().form.route).toBe('1000');
  });

  it('shows only the start picked so far while picking', () => {
    const { container, pins } = renderLayer();
    act(() => {
      useVehicleCalc.setState({ route: { start: { x: 0, y: 0 }, end: { x: 30_000, y: 40_000 } } });
      useVehicleCalc.getState().startPicking();
    });
    expect(pins()).toEqual([]);
    act(() => useVehicleCalc.getState().pick({ x: 10_000, y: 10_000 }));
    expect(pins()).toEqual([['A', 'Start']]);
    expect(container.querySelectorAll(`.leaflet-${ROUTE_PANE}-pane path`)).toHaveLength(0);
  });

  it('draws the line above the collectible markers and under the pins, without taking clicks', () => {
    const { container, map } = renderLayer();
    act(() => {
      new MarkerLayer(() => []).addTo(map());
      useVehicleCalc.setState({ route: { start: { x: 0, y: 0 }, end: { x: 30_000, y: 40_000 } } });
    });
    const z = (pane: string) => Number(map().getPane(pane)!.style.zIndex || getComputedStyle(map().getPane(pane)!).zIndex);
    const line = map().getPane(ROUTE_PANE)!;
    expect(line.querySelectorAll('path')).toHaveLength(2);
    expect(z(ROUTE_PANE)).toBeGreaterThan(z('ficsmap-markers'));
    // Leaflet's marker pane (A and B) is 600.
    expect(z(ROUTE_PANE)).toBeLessThan(600);
    expect(line.style.pointerEvents).toBe('none');
    expect(container.querySelector('.leaflet-marker-pane .ficsmap-vroute-pin')).not.toBeNull();
  });
});
