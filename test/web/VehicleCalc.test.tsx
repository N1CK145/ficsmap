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
import { VehicleRouteLayer } from '../../src/web/features/vehicleCalc/VehicleRouteLayer.js';
import { findItem } from '../../src/web/features/vehicleCalc/VehicleCalculator.js';
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

/** The fleet result (vehicles needed or throughput) and what one vehicle does on the route. */
const status = () => screen.getByRole('status', { name: 'Result' });
const trip = (name = 'One vehicle on this route') => screen.getByRole('status', { name });

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
  });

  it('loads the vehicle data only when opened, and computes the trucks needed in stacks without an item', async () => {
    const { calls, router } = setup('present');
    expect(calls).toEqual([]);
    const page = await open();
    expect(router.state.location.pathname).toBe(`/w/${W}/vehicles`);
    expect(screen.getByRole('link', { name: 'Vehicles' })).toHaveAttribute('aria-current', 'page');
    const route = await within(page).findByLabelText('Route length (one way)');
    expect(calls.map(c => c.path)).toEqual(['/data/test/transport.json']);

    // Truck is the default, its speed defaults to the game's straight-path limit (25 m/s), its stop to 2 x 8 s.
    expect(within(page).getByLabelText('Vehicle')).toHaveValue('truck');
    expect(within(page).getByLabelText('Average speed')).toHaveValue(90);
    expect(within(page).getByLabelText('Average speed')).toHaveAccessibleDescription(/Default from the game data/);
    expect(within(page).getByLabelText('Load and unload time per round trip')).toHaveValue(16);
    expect(within(page).getByLabelText('Fuel')).toHaveValue('Desc_Fuel_C');
    expect(within(page).getByLabelText('Fuel')).toHaveAccessibleDescription(/burn 5 MJ per metre driven, there and back.*estimate/);
    expect(status()).toHaveTextContent('Enter the route length');
    expect(trip()).toHaveTextContent('Pick the route on the map or enter its length');

    const u = user();
    // 1800 m at 90 km/h: 144 s there and back + 16 s = 160 s; 48 stacks per trip = 18 stacks/min per truck
    await u.type(route, '1800');
    await u.type(within(page).getByLabelText('Target throughput'), '40');
    expect(status()).toHaveTextContent('Vehicles needed3');
    expect(status()).toHaveTextContent('Utilisation74%');
    expect(status()).toHaveTextContent('They move up to54 stacks/min');
    // One truck: 72 s one way, 160 s round trip, 18 stacks/min
    expect(trip()).toHaveTextContent('One-way trip1 min 12 s');
    expect(trip()).toHaveTextContent('Round trip with stops2 min 40 s');
    expect(trip()).toHaveTextContent('Moves18 stacks/min');
    expect(trip()).toHaveTextContent('Load per trip48 stacks');
    // 2 x 1800 m x 5 MJ = 18 000 MJ = 24 Packaged Fuel per round trip of 160 s, 9 per minute per truck, 27 for three
    expect(trip()).toHaveTextContent('Fuel per round trip24 Packaged Fuel9 per minute');
    expect(status()).toHaveTextContent('Fuel (estimated)27 Packaged Fuel/min');
    // The speed of wheeled vehicles does not depend on the fuel: no table of fuels.
    expect(within(page).queryByRole('table')).toBeNull();
    await u.selectOptions(within(page).getByLabelText('Fuel'), 'Desc_Coal_C');
    expect(trip()).toHaveTextContent('Fuel per round trip60 Coal22.5 per minute');
    expect(status()).toHaveTextContent('Fuel (estimated)67.5 Coal/min');
  });

  it("defaults the Tractor's speed to where its tractive effort ends and the Fluid Truck's stop to its station", async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.selectOptions(await within(page).findByLabelText('Vehicle'), 'tractor');
    // 19.6 m/s, below the straight-path limit of 25 m/s (90 km/h)
    expect(within(page).getByLabelText('Average speed')).toHaveValue(70.6);
    expect(within(page).getByLabelText('Average speed')).toHaveAccessibleDescription(/tractive effort drops to zero \(70.6 km\/h\).*limit of 90 km\/h/);
    await u.selectOptions(within(page).getByLabelText('Vehicle'), 'fluidTruck');
    expect(within(page).getByLabelText('Average speed')).toHaveValue(90);
    expect(within(page).getByLabelText('Load and unload time per round trip')).toHaveValue(18);
    expect(within(page).getByLabelText('Load and unload time per round trip')).toHaveAccessibleDescription(/Fluid Truck Station at each end \(18 s\).*not tested/);
  });

  it('offers the drone its own fuels, with the speed and trip cost of the chosen one', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.selectOptions(await within(page).findByLabelText('Vehicle'), 'drone');
    const fuel = within(page).getByLabelText('Fuel');
    expect(within(fuel).getAllByRole('option').map(o => o.textContent)).toEqual(['Battery', 'Packaged Fuel']);
    expect(fuel).toHaveValue('Desc_Fuel_C');
    expect(fuel).toHaveAccessibleDescription(/24,000 MJ for the take-offs and landings plus 6 MJ per metre flown/);
    expect(within(page).getByLabelText('Average speed')).toHaveValue(180);
    expect(within(page).getByLabelText('Average speed')).toHaveAccessibleDescription(/travel speed with Packaged Fuel \(180 km\/h\)/);
    await u.type(within(page).getByLabelText('Route length (one way)'), '1000');
    await u.click(within(page).getByRole('radio', { name: 'Throughput' }));
    await u.type(within(page).getByLabelText('Number of vehicles'), '1');
    // 2 x 1000 m at 50 m/s = 40 s + 102 s; 24 000 + 12 000 MJ = 48 Packaged Fuel per round trip of 142 s
    expect(trip()).toHaveTextContent('One-way trip20 s');
    expect(trip()).toHaveTextContent('Round trip with stops2 min 22 s');
    expect(trip()).toHaveTextContent('Fuel per round trip48 Packaged Fuel20.28 per minute');
    expect(trip()).toHaveTextContent('Moves3.8 stacks/min');
    expect(status()).toHaveTextContent('Fuel (estimated)20.28 Packaged Fuel/min');
    await u.selectOptions(fuel, 'Desc_Battery_C');
    expect(within(page).getByLabelText('Average speed')).toHaveValue(270);
    expect(trip()).toHaveTextContent('Fuel per round trip6 Battery');
    // The wheeled vehicles keep their own fuel.
    await u.selectOptions(within(page).getByLabelText('Vehicle'), 'truck');
    expect(within(page).getByLabelText('Fuel')).toHaveValue('Desc_Fuel_C');
  });

  it('computes the throughput of a number of vehicles in items and stacks for an item', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.type(await within(page).findByLabelText('Route length (one way)'), '1800');
    await u.type(within(page).getByLabelText('Item (optional)'), 'iron plate');
    await u.click(within(page).getByRole('radio', { name: 'Throughput' }));
    await u.type(within(page).getByLabelText('Number of vehicles'), '2');
    expect(status()).toHaveTextContent('Throughput7,200 items/min (36 stacks/min)');
    // One truck: 18 stacks of 200 plates a minute.
    expect(trip()).toHaveTextContent('Moves18 stacks/min3,600 items/min');
    expect(trip()).toHaveTextContent('Load per trip9,600 items');
  });

  it('asks for the speed where the game data has none, and gives fluids in m³', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.selectOptions(await within(page).findByLabelText('Vehicle'), 'freightCar');
    const speed = within(page).getByLabelText('Average speed');
    expect(speed).toHaveValue(null);
    expect(speed).toHaveAccessibleDescription(/Not in the game data/);
    expect(within(page).getByText(/Counts freight cars/)).toBeInTheDocument();
    await u.type(within(page).getByLabelText('Route length (one way)'), '3000');
    await u.type(speed, '120');
    await u.type(within(page).getByLabelText('Item (optional)'), 'Water');
    // 2 x 90 s + 54 s = 234 s per round trip; 2400 m³ per trip
    await u.type(within(page).getByLabelText('Target throughput'), '1000');
    expect(within(page).getByText('m³/min')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Freight cars needed2');
    expect(trip('One freight car on this route')).toHaveTextContent('Moves615.4 m³/min');
    expect(trip('One freight car on this route')).toHaveTextContent('Round trip with stops3 min 54 s');
    expect(within(page).queryByLabelText('Fuel')).toBeNull();
    expect(status()).not.toHaveTextContent('Fuel');
    expect(trip('One freight car on this route')).not.toHaveTextContent('Fuel');
  });

  it('says when the vehicle cannot carry the item', async () => {
    setup('present');
    const page = await open();
    const u = user();
    await u.type(await within(page).findByLabelText('Item (optional)'), 'Water');
    expect(within(page).getByLabelText('Item (optional)')).toHaveAccessibleDescription('Truck cannot carry Water.');
    expect(status()).toHaveTextContent('Enter the route length');
  });

  it('keeps the form when the page is left and works in German', async () => {
    initI18n(['de']);
    setup('present');
    await user().click(screen.getByRole('link', { name: 'Fahrzeuge' }));
    const page = await screen.findByRole('main', { name: 'Fahrzeug-Rechner' });
    await user().type(await within(page).findByLabelText('Gegenstand (optional)'), 'Eisenplatte');
    expect(useVehicleCalc.getState().form.item).toBe('Eisenplatte');
    expect(within(page).getByText('Stück/min')).toBeInTheDocument();
    await user().click(within(page).getByRole('link', { name: 'Zurück zur Karte' }));
    expect(screen.queryByRole('main')).toBeNull();
    await user().click(screen.getByRole('link', { name: 'Fahrzeuge' }));
    expect(await screen.findByLabelText('Gegenstand (optional)')).toHaveValue('Eisenplatte');
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
    expect(within(page).getByText(/die Luftlinie dazwischen wird die Streckenlänge/)).toBeInTheDocument();
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
    await waitFor(() => expect(routeInfo()).toHaveTextContent('Höhenunterschied (zum Ziel)+58 m'));
    expect(routeInfo()).toHaveTextContent('3D-Länge208 m');
    expect(routeInfo()).toHaveTextContent('für Drohnen genau');
    expect(routeInfo()).toHaveTextContent('Untergrenze');

    // One truck on 200 m at 90 km/h: 8 s one way, 16 s there and back plus 16 s at the stations, 48 stacks a trip.
    const trip = screen.getByRole('status', { name: 'Ein Fahrzeug auf dieser Strecke' });
    expect(trip).toHaveTextContent('Fahrt (einfach)8 s');
    expect(trip).toHaveTextContent('Umlauf mit Standzeit32 s');
    expect(trip).toHaveTextContent('Transportiert90 Stapel/min');
    // 2 x 200 m x 5 MJ = 2000 MJ = 2.67 Packaged Fuel per round trip.
    expect(trip).toHaveTextContent('Treibstoff pro Umlauf2,67 Abgefüllter Treibstoff5 pro Minute');
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
    expect(routeInfo()).toHaveTextContent('Die Länge wurde eingetippt');
    act(() => useVehicleCalc.getState().moveRoutePoint('end', { x: 60_000, y: 80_000 }));
    expect(routeInput()).toHaveValue(650);
    expect(routeInfo()).toHaveTextContent('Luftlinie1.000 m');
    await u.click(within(page).getByRole('button', { name: 'Luftlinie übernehmen' }));
    expect(routeInput()).toHaveValue(1000);
    expect(routeInfo()).not.toHaveTextContent('Die Länge wurde eingetippt');

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

  it('shows the drone per fuel, the selected fuel marked, because its speed depends on the fuel', async () => {
    setupPicking();
    const page = await openDe();
    const u = user();
    await u.selectOptions(within(page).getByLabelText('Fahrzeug'), 'drone');
    await u.type(routeInput(), '1000');
    const table = within(page).getByRole('table', { name: /Die Geschwindigkeit der Drohne hängt vom Treibstoff ab/ });
    const rows = within(table).getAllByRole('row').slice(1);
    // Fastest first. Battery: 75 m/s, 13.3 s one way, 128.7 s round trip, 6 Batteries, 9 stacks = 4.2 stacks/min.
    expect(rows.map(r => within(r).getByRole('rowheader').textContent)).toEqual(['Batterie', 'Abgefüllter Treibstoff']);
    expect(within(rows[0]!).getAllByRole('cell').map(c => c.textContent)).toEqual(['270 km/h', '13,3 s', '2 min 9 s', '6', '4,2']);
    expect(within(rows[1]!).getAllByRole('cell').map(c => c.textContent)).toEqual(['180 km/h', '20 s', '2 min 22 s', '48', '3,8']);
    expect(within(table).getByRole('row', { current: true })).toHaveTextContent('Abgefüllter Treibstoff');
    expect(screen.getByRole('status', { name: 'Ein Fahrzeug auf dieser Strecke' })).toHaveTextContent('Umlauf mit Standzeit2 min 22 s');

    await u.selectOptions(within(page).getByLabelText('Treibstoff'), 'Desc_Battery_C');
    expect(within(table).getByRole('row', { current: true })).toHaveTextContent('Batterie');
    expect(screen.getByRole('status', { name: 'Ein Fahrzeug auf dieser Strecke' })).toHaveTextContent('Umlauf mit Standzeit2 min 9 s');
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
    return { container, pins, markers };
  }

  it('shows A and B with the line while the route is set, and drags them', () => {
    const { container, pins, markers } = renderLayer();
    expect(pins()).toEqual([]);
    act(() => useVehicleCalc.setState({ route: { start: { x: 0, y: 0 }, end: { x: 30_000, y: 40_000 } }, lengthFromRoute: true, form: { ...EMPTY_FORM, route: '500' } }));
    expect(pins()).toEqual([['A', 'Start'], ['B', 'Ziel']]);
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(1);

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
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(0);
  });
});
