import {
  calculate, defaultSpeed, driveSeconds, loadFor, oneWaySeconds, perTrip, roundTripSeconds, tripEnergyMJ, tripsByFuel, vehicleFuels,
  type FuelUse, type TransportFuel, type TransportItem, type TransportVehicle,
} from '../../src/shared/transport.js';

// Values as in the dataset built from 1.2.5.0.
const AUTOPILOT: FuelUse = { source: 'autopilot', perMetreMJ: 5, perTripMJ: 0, fuels: null };
const DRONE_PORT: FuelUse = { source: 'dronePort', perMetreMJ: 6, perTripMJ: 24_000, fuels: [{ id: 'Desc_Battery_C', speed: 75 }, { id: 'Desc_Fuel_C', speed: 50 }] };
const TRUCK: TransportVehicle = { id: 'truck', name: { en: 'Truck', de: 'Lkw' }, slots: 48, fluidCapacity: null, stopSeconds: 48, stopSource: 'truckStation', straightPathSpeed: 25, tractionSpeed: 26.2, fuel: AUTOPILOT };
const TRACTOR: TransportVehicle = { ...TRUCK, id: 'tractor', name: { en: 'Tractor', de: 'Schlepper' }, slots: 25, tractionSpeed: 19.6 };
const EXPLORER: TransportVehicle = { ...TRUCK, id: 'explorer', name: { en: 'Explorer', de: 'Explorer' }, slots: 12, straightPathSpeed: 28, tractionSpeed: 27.9 };
const FLUID_TRUCK: TransportVehicle = { id: 'fluidTruck', name: { en: 'Fluid Truck', de: 'Tanklaster' }, slots: null, fluidCapacity: 3200, stopSeconds: 18, stopSource: 'fluidTruckStation', straightPathSpeed: 25, tractionSpeed: 26.2, fuel: AUTOPILOT };
const FREIGHT: TransportVehicle = { id: 'freightCar', name: { en: 'Freight Car', de: 'Güterwagen' }, slots: 32, fluidCapacity: 2400, stopSeconds: 54, stopSource: 'freightPlatform', straightPathSpeed: null, tractionSpeed: null, fuel: null };
const DRONE: TransportVehicle = { id: 'drone', name: { en: 'Drone', de: 'Drohne' }, slots: 9, fluidCapacity: null, stopSeconds: 102, stopSource: 'dronePort', straightPathSpeed: null, tractionSpeed: null, fuel: DRONE_PORT };
const FUELS: TransportFuel[] = [
  { id: 'Desc_Coal_C', name: { en: 'Coal', de: 'Kohle' }, energyMJ: 300 },
  { id: 'Desc_Fuel_C', name: { en: 'Packaged Fuel', de: 'Abgefüllter Treibstoff' }, energyMJ: 750 },
  { id: 'Desc_Battery_C', name: { en: 'Battery', de: 'Batterie' }, energyMJ: 6000 },
];
const PLATE: TransportItem = { id: 'Desc_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, stackSize: 200, fluid: false };
const WATER: TransportItem = { id: 'Desc_Water_C', name: { en: 'Water', de: 'Wasser' }, stackSize: 50_000, fluid: true };

describe('vehicle calculator maths', () => {
  it('computes the round trip: there and back at the average speed plus the stops', () => {
    // 900 m at 36 km/h (10 m/s): 90 s each way, plus 48 s at the stations
    expect(roundTripSeconds({ routeMeters: 900, speedKmh: 36, stopSeconds: 48 })).toBe(228);
    expect(roundTripSeconds({ routeMeters: 0, speedKmh: 36, stopSeconds: 30 })).toBe(30);
    expect(driveSeconds({ routeMeters: 900, speedKmh: 36, stopSeconds: 48 })).toBe(180);
    expect(oneWaySeconds({ routeMeters: 900, speedKmh: 36 })).toBe(90);
  });

  it('gives the load per trip in stacks, items or m³', () => {
    expect(perTrip({ unit: 'stacks', slots: 48 })).toBe(48);
    expect(perTrip({ unit: 'items', slots: 48, stackSize: 200 })).toBe(9600);
    expect(perTrip({ unit: 'm3', m3: 3200 })).toBe(3200);
  });

  it('picks the load for a vehicle and an optional item', () => {
    expect(loadFor(TRUCK, null)).toEqual({ unit: 'stacks', slots: 48 });
    expect(loadFor(TRUCK, PLATE)).toEqual({ unit: 'items', slots: 48, stackSize: 200 });
    expect(loadFor(TRUCK, WATER)).toBeNull();
    expect(loadFor(FLUID_TRUCK, null)).toEqual({ unit: 'm3', m3: 3200 });
    expect(loadFor(FLUID_TRUCK, WATER)).toEqual({ unit: 'm3', m3: 3200 });
    expect(loadFor(FLUID_TRUCK, PLATE)).toBeNull();
    expect(loadFor(FREIGHT, WATER)).toEqual({ unit: 'm3', m3: 2400 });
    expect(loadFor(FREIGHT, PLATE)).toEqual({ unit: 'items', slots: 32, stackSize: 200 });
  });

  // Round trip 120 s: 48 stacks per trip = 24 stacks/min per truck, 4800 plates/min with 200 per stack.
  const trip = { routeMeters: 1000, speedKmh: 100, stopSeconds: 48 };

  it('finds the vehicles needed for a target, rounded up, with the utilisation', () => {
    const r = calculate(trip, { unit: 'items', slots: 48, stackSize: 200 }, { kind: 'vehicles', targetPerMinute: 6000 })!;
    expect(r.roundTripSeconds).toBe(120);
    expect(r.perTrip).toBe(9600);
    expect(r.perVehiclePerMinute).toBe(4800);
    expect(r.stacksPerVehiclePerMinute).toBe(24);
    expect(r.vehicles).toBe(2);
    expect(r.utilisation).toBeCloseTo(6000 / 9600);
    expect(r.capacityPerMinute).toBe(9600);
    expect(r.capacityStacksPerMinute).toBe(48);
  });

  it('does not round an exact multiple up (floating point)', () => {
    // 0.1 + 0.2 style noise: 3 x 4800 exactly needs 3 vehicles
    const r = calculate(trip, { unit: 'items', slots: 48, stackSize: 200 }, { kind: 'vehicles', targetPerMinute: 14_400.000000000002 })!;
    expect(r.vehicles).toBe(3);
    expect(r.utilisation).toBeCloseTo(1);
  });

  it('needs no vehicle for a target of 0', () => {
    const r = calculate(trip, { unit: 'stacks', slots: 48 }, { kind: 'vehicles', targetPerMinute: 0 })!;
    expect(r.vehicles).toBe(0);
    expect(r.utilisation).toBe(0);
  });

  it('gives the throughput of a number of vehicles', () => {
    const r = calculate(trip, { unit: 'stacks', slots: 48 }, { kind: 'rate', vehicles: 3 })!;
    expect(r.capacityPerMinute).toBe(72);
    expect(r.capacityStacksPerMinute).toBe(72);
    expect(r.utilisation).toBeNull();
    const fluid = calculate(trip, { unit: 'm3', m3: 3200 }, { kind: 'rate', vehicles: 2 })!;
    expect(fluid.capacityPerMinute).toBeCloseTo(3200);
    expect(fluid.stacksPerVehiclePerMinute).toBeNull();
    expect(fluid.capacityStacksPerMinute).toBeNull();
  });

  it('burns fuel per distance on autopilot: 2 x route x MJ per metre / energy per item, spread over the round trip', () => {
    // 2 x 1000 m x 5 MJ = 10 000 MJ = 13.33 Packaged Fuel (750 MJ) per round trip of 120 s, 6.67 per minute.
    const fuel = { perMetreMJ: 5, perTripMJ: 0, energyMJ: 750 };
    expect(tripEnergyMJ(trip, fuel)).toBe(10_000);
    const r = calculate(trip, { unit: 'stacks', slots: 48 }, { kind: 'vehicles', targetPerMinute: 30 }, fuel)!;
    expect(r.vehicles).toBe(2);
    expect(r.fuel!.perTrip).toBeCloseTo(13.333);
    expect(r.fuel!.perVehiclePerMinute).toBeCloseTo(6.667);
    expect(r.fuel!.perMinute).toBeCloseTo(13.333);
    // The speed does not change the fuel per trip, only how often the trip is made.
    const slow = calculate({ ...trip, speedKmh: 50 }, { unit: 'stacks', slots: 48 }, { kind: 'rate', vehicles: 1 }, fuel)!;
    expect(slow.fuel!.perTrip).toBeCloseTo(13.333);
    expect(slow.fuel!.perVehiclePerMinute).toBeCloseTo(13.333 * 60 / 192);
    expect(calculate(trip, { unit: 'stacks', slots: 48 }, { kind: 'rate', vehicles: 1 })!.fuel).toBeNull();
    // Standing only (route 0): no fuel.
    const parked = calculate({ routeMeters: 0, speedKmh: 50, stopSeconds: 16 }, { unit: 'stacks', slots: 48 }, { kind: 'rate', vehicles: 1 }, fuel)!;
    expect(parked.fuel!.perMinute).toBe(0);
    expect(calculate(trip, { unit: 'stacks', slots: 48 }, { kind: 'rate', vehicles: 1 }, { ...fuel, energyMJ: 0 })).toBeNull();
    expect(calculate(trip, { unit: 'stacks', slots: 48 }, { kind: 'rate', vehicles: 1 }, { ...fuel, perMetreMJ: -1 })).toBeNull();
  });

  it('gives the drone a fixed cost per round trip plus 6 MJ per metre flown there and back', () => {
    // Players' test: 24 000 MJ + 12 MJ x port distance; 1000 m = 36 000 MJ = 48 Packaged Fuel or 6 Batteries.
    const fuel = { perMetreMJ: 6, perTripMJ: 24_000, energyMJ: 750 };
    expect(tripEnergyMJ(trip, fuel)).toBe(36_000);
    const r = calculate(trip, { unit: 'stacks', slots: 9 }, { kind: 'rate', vehicles: 2 }, fuel)!;
    expect(r.fuel!.perTrip).toBe(48);
    expect(r.fuel!.perVehiclePerMinute).toBe(24);
    expect(r.fuel!.perMinute).toBe(48);
    expect(calculate(trip, { unit: 'stacks', slots: 9 }, { kind: 'rate', vehicles: 1 }, { ...fuel, energyMJ: 6000 })!.fuel!.perTrip).toBe(6);
    // Ports on top of each other: only the take-offs and landings (32 Packaged Fuel).
    const stacked = calculate({ routeMeters: 0, speedKmh: 180, stopSeconds: 102 }, { unit: 'stacks', slots: 9 }, { kind: 'rate', vehicles: 1 }, fuel)!;
    expect(stacked.fuel!.perTrip).toBe(32);
  });

  it('defaults the speed to the straight-path limit, or the lower speed where the tractive effort ends', () => {
    expect(defaultSpeed(TRUCK, null)).toEqual({ mps: 25, source: 'pathLimit' });
    expect(defaultSpeed(TRACTOR, null)).toEqual({ mps: 19.6, source: 'traction' });
    expect(defaultSpeed(EXPLORER, null)).toEqual({ mps: 27.9, source: 'traction' });
    expect(defaultSpeed({ ...TRUCK, straightPathSpeed: null }, null)).toEqual({ mps: 26.2, source: 'traction' });
    expect(defaultSpeed(FREIGHT, null)).toBeNull();
  });

  it('defaults the drone speed to the travel speed of its fuel', () => {
    expect(defaultSpeed(DRONE, 'Desc_Fuel_C')).toEqual({ mps: 50, source: 'droneFuel' });
    expect(defaultSpeed(DRONE, 'Desc_Battery_C')).toEqual({ mps: 75, source: 'droneFuel' });
    expect(defaultSpeed(DRONE, 'Desc_Coal_C')).toBeNull();
  });

  it('lists the fuels a vehicle takes: every fuel, the drone its own, none without fuel use', () => {
    expect(vehicleFuels(FUELS, TRUCK).map(f => f.id)).toEqual(['Desc_Coal_C', 'Desc_Fuel_C', 'Desc_Battery_C']);
    expect(vehicleFuels(FUELS, DRONE).map(f => f.id)).toEqual(['Desc_Battery_C', 'Desc_Fuel_C']);
    expect(vehicleFuels(FUELS, FREIGHT)).toEqual([]);
    // Vehicle data built before fuel use was added has no `fuel`.
    const { fuel: _, ...old } = TRUCK;
    expect(vehicleFuels(FUELS, old as TransportVehicle)).toEqual([]);
  });

  it('gives one drone on a route per fuel, at the speed of that fuel, fastest first', () => {
    // 1000 m, 102 s at the ports. Battery: 75 m/s, 13.3 s each way, 128.7 s round trip, 36 000 MJ = 6 Batteries;
    // Packaged Fuel: 50 m/s, 20 s each way, 142 s round trip, 48 Packaged Fuel. 9 stacks per trip.
    const rows = tripsByFuel(DRONE, FUELS, { routeMeters: 1000, stopSeconds: 102 }, { unit: 'stacks', slots: 9 });
    expect(rows.map(r => r.fuel.id)).toEqual(['Desc_Battery_C', 'Desc_Fuel_C']);
    const [battery, fuel] = rows as [typeof rows[0], typeof rows[0]];
    expect(battery.speed).toBe(75);
    expect(battery.oneWaySeconds).toBeCloseTo(13.333);
    expect(battery.roundTripSeconds).toBeCloseTo(128.667);
    expect(battery.fuelPerRoundTrip).toBeCloseTo(6);
    expect(battery.stacksPerMinute).toBeCloseTo(9 * 60 / 128.667);
    expect(fuel).toMatchObject({ speed: 50, roundTripSeconds: 142, fuelPerRoundTrip: 48 });
    expect(fuel.oneWaySeconds).toBeCloseTo(20);
    // With an item: items per minute, and still the stacks.
    const plates = tripsByFuel(DRONE, FUELS, { routeMeters: 1000, stopSeconds: 102 }, { unit: 'items', slots: 9, stackSize: 200 });
    expect(plates[1]!.perMinute).toBeCloseTo(1800 * 60 / 142);
    expect(plates[1]!.stacksPerMinute).toBeCloseTo(9 * 60 / 142);
  });

  it('gives wheeled vehicles the same speed with every fuel, and nothing for unusable input', () => {
    const rows = tripsByFuel(TRUCK, FUELS, { routeMeters: 1800, stopSeconds: 16 }, { unit: 'stacks', slots: 48 });
    expect(rows.map(r => r.speed)).toEqual([25, 25, 25]);
    // 2 x 1800 m x 5 MJ = 18 000 MJ: 60 Coal, 24 Packaged Fuel, 3 Batteries.
    expect(rows.map(r => r.fuelPerRoundTrip)).toEqual([60, 24, 3]);
    expect(tripsByFuel(FREIGHT, FUELS, { routeMeters: 1800, stopSeconds: 54 }, { unit: 'stacks', slots: 32 })).toEqual([]);
    expect(tripsByFuel(DRONE, FUELS, { routeMeters: Number.NaN, stopSeconds: 102 }, { unit: 'stacks', slots: 9 })).toEqual([]);
  });

  it('rejects unusable input', () => {
    const load = { unit: 'stacks', slots: 48 } as const;
    const goal = { kind: 'rate', vehicles: 1 } as const;
    expect(calculate({ ...trip, speedKmh: 0 }, load, goal)).toBeNull();
    expect(calculate({ ...trip, speedKmh: Number.NaN }, load, goal)).toBeNull();
    expect(calculate({ ...trip, routeMeters: -1 }, load, goal)).toBeNull();
    expect(calculate({ ...trip, stopSeconds: -5 }, load, goal)).toBeNull();
    expect(calculate({ routeMeters: 0, speedKmh: 50, stopSeconds: 0 }, load, goal)).toBeNull(); // zero round trip
    expect(calculate(trip, { unit: 'stacks', slots: 0 }, goal)).toBeNull();
    expect(calculate(trip, load, { kind: 'rate', vehicles: 1.5 })).toBeNull();
    expect(calculate(trip, load, { kind: 'rate', vehicles: -1 })).toBeNull();
    expect(calculate(trip, load, { kind: 'vehicles', targetPerMinute: Number.NaN })).toBeNull();
  });
});
