import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { TransportData } from '../../src/shared/transport.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { vehicleCalcFeature, vehicleCalcTool } from '../../src/web/features/vehicleCalc/index.js';
import { EMPTY_FORM, useVehicleCalc } from '../../src/web/features/vehicleCalc/useVehicleCalc.js';
import { VehicleCalcHost } from '../../src/web/features/vehicleCalc/VehicleCalcDialog.js';
import { ToolButton } from '../../src/web/features/worlds/ToolsNav.js';
import { findItem } from '../../src/web/features/vehicleCalc/VehicleCalculator.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };
const WORLD: WorldDto = {
  id: W, name: 'Alpha', isOwner: true, rev: 1, datasetVersion: 'test', owner: { id: 1, displayName: 'Nick' }, members: [], lastImport: null,
};
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }], items: [], aliases: {},
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
  render(<QueryClientProvider client={client}><ToolButton tool={vehicleCalcTool} ctx={ctx} /><VehicleCalcHost ctx={ctx} /></QueryClientProvider>);
  return { calls };
}

const user = () => userEvent.setup();

async function open() {
  await user().click(screen.getByRole('button', { name: 'Vehicles' }));
  return screen.findByRole('dialog', { name: 'Vehicle calculator' });
}

const status = () => screen.getByRole('status');

describe('vehicle calculator', () => {
  beforeEach(() => {
    initI18n(['en']);
    useVehicleCalc.setState({ open: false, form: EMPTY_FORM });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is a tool that opens a dialog, and the dialog is a header item', () => {
    expect(vehicleCalcFeature.tools).toEqual([vehicleCalcTool]);
    expect(vehicleCalcTool.action).toBe(true);
    expect(vehicleCalcFeature.headerItems?.map(h => h.id)).toEqual(['vehicle-calc-dialog']);
  });

  it('loads the vehicle data only when opened, and computes the trucks needed in stacks without an item', async () => {
    const { calls } = setup('present');
    expect(calls).toEqual([]);
    const dialog = await open();
    const route = await within(dialog).findByLabelText('Route length (one way)');
    expect(calls.map(c => c.path)).toEqual(['/data/test/transport.json']);

    // Truck is the default, its speed defaults to the game's straight-path limit (25 m/s), its stop to 2 x 8 s.
    expect(within(dialog).getByLabelText('Vehicle')).toHaveValue('truck');
    expect(within(dialog).getByLabelText('Average speed')).toHaveValue(90);
    expect(within(dialog).getByLabelText('Average speed')).toHaveAccessibleDescription(/Default from the game data/);
    expect(within(dialog).getByLabelText('Load and unload time per round trip')).toHaveValue(16);
    expect(within(dialog).getByLabelText('Fuel')).toHaveValue('Desc_Fuel_C');
    expect(within(dialog).getByLabelText('Fuel')).toHaveAccessibleDescription(/burn 5 MJ per metre driven, there and back.*estimate/);
    expect(status()).toHaveTextContent('Enter the route length');

    const u = user();
    // 1800 m at 90 km/h: 144 s there and back + 16 s = 160 s; 48 stacks per trip = 18 stacks/min per truck
    await u.type(route, '1800');
    await u.type(within(dialog).getByLabelText('Target throughput'), '40');
    expect(status()).toHaveTextContent('Vehicles needed3');
    expect(status()).toHaveTextContent('Utilisation74%');
    expect(status()).toHaveTextContent('They move up to54 stacks/min');
    expect(status()).toHaveTextContent('Per vehicle18 stacks/min');
    expect(status()).toHaveTextContent('Round trip160 s');
    // 2 x 1800 m x 5 MJ = 18 000 MJ = 24 Packaged Fuel per round trip of 160 s, 9 per minute per truck
    expect(status()).toHaveTextContent('Fuel (estimated)27 Packaged Fuel/min (9 per vehicle, 24 per round trip)');
    await u.selectOptions(within(dialog).getByLabelText('Fuel'), 'Desc_Coal_C');
    expect(status()).toHaveTextContent('Fuel (estimated)67.5 Coal/min (22.5 per vehicle, 60 per round trip)');
  });

  it("defaults the Tractor's speed to where its tractive effort ends and the Fluid Truck's stop to its station", async () => {
    setup('present');
    const dialog = await open();
    const u = user();
    await u.selectOptions(await within(dialog).findByLabelText('Vehicle'), 'tractor');
    // 19.6 m/s, below the straight-path limit of 25 m/s (90 km/h)
    expect(within(dialog).getByLabelText('Average speed')).toHaveValue(70.6);
    expect(within(dialog).getByLabelText('Average speed')).toHaveAccessibleDescription(/tractive effort drops to zero \(70.6 km\/h\).*limit of 90 km\/h/);
    await u.selectOptions(within(dialog).getByLabelText('Vehicle'), 'fluidTruck');
    expect(within(dialog).getByLabelText('Average speed')).toHaveValue(90);
    expect(within(dialog).getByLabelText('Load and unload time per round trip')).toHaveValue(18);
    expect(within(dialog).getByLabelText('Load and unload time per round trip')).toHaveAccessibleDescription(/Fluid Truck Station at each end \(18 s\).*not tested/);
  });

  it('offers the drone its own fuels, with the speed and trip cost of the chosen one', async () => {
    setup('present');
    const dialog = await open();
    const u = user();
    await u.selectOptions(await within(dialog).findByLabelText('Vehicle'), 'drone');
    const fuel = within(dialog).getByLabelText('Fuel');
    expect(within(fuel).getAllByRole('option').map(o => o.textContent)).toEqual(['Battery', 'Packaged Fuel']);
    expect(fuel).toHaveValue('Desc_Fuel_C');
    expect(fuel).toHaveAccessibleDescription(/24,000 MJ for the take-offs and landings plus 6 MJ per metre flown/);
    expect(within(dialog).getByLabelText('Average speed')).toHaveValue(180);
    expect(within(dialog).getByLabelText('Average speed')).toHaveAccessibleDescription(/travel speed with Packaged Fuel \(180 km\/h\)/);
    await u.type(within(dialog).getByLabelText('Route length (one way)'), '1000');
    await u.click(within(dialog).getByRole('radio', { name: 'Throughput' }));
    await u.type(within(dialog).getByLabelText('Number of vehicles'), '1');
    // 2 x 1000 m at 50 m/s = 40 s + 102 s; 24 000 + 12 000 MJ = 48 Packaged Fuel per round trip of 142 s
    expect(status()).toHaveTextContent('Round trip142 s');
    expect(status()).toHaveTextContent('Fuel (estimated)20.28 Packaged Fuel/min (20.28 per vehicle, 48 per round trip)');
    await u.selectOptions(fuel, 'Desc_Battery_C');
    expect(within(dialog).getByLabelText('Average speed')).toHaveValue(270);
    expect(status()).toHaveTextContent('6 per round trip');
    // The wheeled vehicles keep their own fuel.
    await u.selectOptions(within(dialog).getByLabelText('Vehicle'), 'truck');
    expect(within(dialog).getByLabelText('Fuel')).toHaveValue('Desc_Fuel_C');
  });

  it('computes the throughput of a number of vehicles in items and stacks for an item', async () => {
    setup('present');
    const dialog = await open();
    const u = user();
    await u.type(await within(dialog).findByLabelText('Route length (one way)'), '1800');
    await u.type(within(dialog).getByLabelText('Item (optional)'), 'iron plate');
    await u.click(within(dialog).getByRole('radio', { name: 'Throughput' }));
    await u.type(within(dialog).getByLabelText('Number of vehicles'), '2');
    expect(status()).toHaveTextContent('Throughput7,200 items/min (36 stacks/min)');
    expect(status()).toHaveTextContent('Load per trip9,600 items');
  });

  it('asks for the speed where the game data has none, and gives fluids in m³', async () => {
    setup('present');
    const dialog = await open();
    const u = user();
    await u.selectOptions(await within(dialog).findByLabelText('Vehicle'), 'freightCar');
    const speed = within(dialog).getByLabelText('Average speed');
    expect(speed).toHaveValue(null);
    expect(speed).toHaveAccessibleDescription(/Not in the game data/);
    expect(within(dialog).getByText(/Counts freight cars/)).toBeInTheDocument();
    await u.type(within(dialog).getByLabelText('Route length (one way)'), '3000');
    await u.type(speed, '120');
    await u.type(within(dialog).getByLabelText('Item (optional)'), 'Water');
    // 2 x 90 s + 54 s = 234 s per round trip; 2400 m³ per trip
    await u.type(within(dialog).getByLabelText('Target throughput'), '1000');
    expect(within(dialog).getByText('m³/min')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Freight cars needed2');
    expect(status()).toHaveTextContent('Per freight car615.4 m³/min');
    expect(within(dialog).queryByLabelText('Fuel')).toBeNull();
    expect(status()).not.toHaveTextContent('Fuel');
  });

  it('says when the vehicle cannot carry the item', async () => {
    setup('present');
    const dialog = await open();
    const u = user();
    await u.type(await within(dialog).findByLabelText('Item (optional)'), 'Water');
    expect(within(dialog).getByLabelText('Item (optional)')).toHaveAccessibleDescription('Truck cannot carry Water.');
    expect(status()).toHaveTextContent('Enter the route length');
  });

  it('keeps the form while closed and works in German', async () => {
    initI18n(['de']);
    setup('present');
    await user().click(screen.getByRole('button', { name: 'Fahrzeuge' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fahrzeug-Rechner' });
    await user().type(await within(dialog).findByLabelText('Gegenstand (optional)'), 'Eisenplatte');
    expect(useVehicleCalc.getState().form.item).toBe('Eisenplatte');
    expect(within(dialog).getByText('Stück/min')).toBeInTheDocument();
  });

  it('shows a notice for a dataset without vehicle data', async () => {
    setup('missing');
    const dialog = await open();
    expect(await within(dialog).findByText(/has no vehicle data/)).toBeInTheDocument();
  });

  it('matches items by name in the current language or English', () => {
    expect(findItem(DATA.items, ' eisenplatte ', 'de')?.id).toBe('Desc_IronPlate_C');
    expect(findItem(DATA.items, 'Water', 'de')?.id).toBe('Desc_Water_C');
    expect(findItem(DATA.items, 'Wat', 'en')).toBeNull();
    expect(findItem(DATA.items, '', 'en')).toBeNull();
  });
});
