/**
 * Vehicle throughput: the dataset's `transport.json` format (built by `scripts/transport.ts` from the
 * game's CommunityResources/Docs and the extractor's `transport.json`) and the pure calculator maths.
 */

export type VehicleId = 'tractor' | 'truck' | 'fluidTruck' | 'explorer' | 'freightCar' | 'drone';

export interface LocalName { en: string; de: string }

/** An item the calculator can convert stacks into: a solid with its stack size, or a fluid (m³ per fluid slot). */
export interface TransportItem {
  /** Descriptor class, e.g. `Desc_IronPlate_C`. */
  id: string;
  name: LocalName;
  /** Items per stack; for a fluid the game's fluid stack size in litres (50 000 = 50 m³). */
  stackSize: number;
  fluid: boolean;
}

/** Where a vehicle's verified stop time comes from (see "Transport" in data-src/extractor/README.md). */
export type StopSource = 'truckStation' | 'fluidTruckStation' | 'freightPlatform' | 'dronePort';

/** A fuel a vehicle with its own fuel list takes (the drone), with the cruising speed it gives. */
export interface VehicleFuelOption {
  /** Fuel item class, one of `TransportData.fuels`. */
  id: string;
  /** Travel speed in m/s with this fuel (drone `mFuelTypes[].TravelSpeed`). */
  speed: number;
}

/**
 * How a vehicle burns fuel on automated trips: energy per round trip = `perTripMJ` + `perMetreMJ` x the distance
 * travelled (2 x the route).
 */
export interface FuelUse {
  /**
   * 'autopilot': wheeled vehicles, per distance driven (Docs `mAutopilotFuelConsumption`, energy per cm, read as MJ).
   * 'dronePort': the drone, a fixed cost per round trip plus a cost per metre flown (Drone Port `mTripPowerCost`,
   * `mTripPowerPerMeterCost`; MJ as tested by players).
   */
  source: 'autopilot' | 'dronePort';
  /** MJ per metre travelled. */
  perMetreMJ: number;
  /** MJ per round trip whatever the distance (the drone's take-offs and landings); 0 for wheeled vehicles. */
  perTripMJ: number;
  /** The fuels it takes with the speed each gives (drone); null: every fuel in `TransportData.fuels`, same speed. */
  fuels: VehicleFuelOption[] | null;
}

export interface TransportVehicle {
  id: VehicleId;
  name: LocalName;
  /** Inventory slots for solid items, null when the vehicle only carries fluids. */
  slots: number | null;
  /** Fluid capacity in m³, null when the vehicle carries no fluids. */
  fluidCapacity: number | null;
  /**
   * Load and unload time per round trip in seconds, from game data; null when the game data has none
   * (the user has to enter it).
   */
  stopSeconds: number | null;
  stopSource: StopSource | null;
  /** The autopilot's speed limit on a straight path in m/s (game data); null when the game data has none. */
  straightPathSpeed: number | null;
  /**
   * The speed in m/s at which the engine's tractive effort reaches 0 (game data): the vehicle gets no faster on
   * level ground. null when the game data has none.
   */
  tractionSpeed: number | null;
  /** Fuel use on automated trips; null for vehicles that burn no fuel items (freight car: electric locomotive). */
  fuel: FuelUse | null;
}

/** A fuel item: every solid item with an energy value (what wheeled vehicles take; the drone takes some of them). */
export interface TransportFuel {
  id: string;
  name: LocalName;
  /** Energy per item in MJ (Docs `mEnergyValue`). */
  energyMJ: number;
}

/** The fuel selected by default: Packaged Fuel. */
export const DEFAULT_FUEL = 'Desc_Fuel_C';

export interface TransportData {
  /** Game version of the extractor output the file was built from. */
  gameVersion: string;
  vehicles: TransportVehicle[];
  items: TransportItem[];
  /** Sorted by energy per item, lowest first. */
  fuels: TransportFuel[];
}

/** Litres per m³: the game stores fluid amounts in litres (a fluid stack of 50 000 is shown as 50 m³). */
export const LITRES_PER_M3 = 1000;

/** What one trip carries, in the unit the rates are given in. */
export type Load =
  | { unit: 'stacks'; slots: number }
  | { unit: 'items'; slots: number; stackSize: number }
  | { unit: 'm3'; m3: number };

export interface TripInput {
  /** One-way route length in metres. */
  routeMeters: number;
  /** Average speed in km/h. */
  speedKmh: number;
  /** Load and unload time per round trip in seconds. */
  stopSeconds: number;
}

/** The fuel a vehicle burns: its use per round trip (see `FuelUse`) and the energy of one fuel item. */
export interface FuelInput {
  perMetreMJ: number;
  perTripMJ: number;
  energyMJ: number;
}

export type Goal = { kind: 'vehicles'; targetPerMinute: number } | { kind: 'rate'; vehicles: number };

export interface CalcResult {
  roundTripSeconds: number;
  /** Units (stacks, items or m³, see `load.unit`) per trip and per minute of one vehicle. */
  perTrip: number;
  perVehiclePerMinute: number;
  /** Stacks per minute of one vehicle (solid loads only). */
  stacksPerVehiclePerMinute: number | null;
  /** Vehicles: needed for the target (rounded up), or the given count. */
  vehicles: number;
  /** Units per minute the vehicles can move at most. */
  capacityPerMinute: number;
  /** The same in stacks per minute (solid loads only). */
  capacityStacksPerMinute: number | null;
  /** Target / capacity (0..1) for the "vehicles" goal; null for the "rate" goal. */
  utilisation: number | null;
  /**
   * Fuel items per round trip, per minute of one vehicle and per minute of all `vehicles`; null without fuel
   * input. An estimate: the game's extra use on climbs (Tractor, Explorer) is not included.
   */
  fuel: { perTrip: number; perVehiclePerMinute: number; perMinute: number } | null;
}

/** Seconds driven per round trip: there and back at the average speed. */
export function driveSeconds({ routeMeters, speedKmh }: TripInput): number {
  return (2 * routeMeters) / (speedKmh / 3.6);
}

/** Seconds for one round trip: driving there and back, plus loading and unloading. */
export function roundTripSeconds(trip: TripInput): number {
  return driveSeconds(trip) + trip.stopSeconds;
}

/** Fuel energy in MJ per round trip: the fixed part plus the distance there and back. */
export function tripEnergyMJ({ routeMeters }: TripInput, { perMetreMJ, perTripMJ }: FuelInput): number {
  return perTripMJ + perMetreMJ * 2 * routeMeters;
}

/** Units carried per trip. */
export function perTrip(load: Load): number {
  if (load.unit === 'm3') return load.m3;
  return load.unit === 'items' ? load.slots * load.stackSize : load.slots;
}

const valid = (n: number, min: number) => Number.isFinite(n) && n >= min;

/**
 * Both directions of the calculator. Returns null for unusable input (route or speed not positive,
 * negative stop time, empty load, negative target or vehicle count, a fractional vehicle count, a
 * fuel with a negative use or no energy).
 */
export function calculate(trip: TripInput, load: Load, goal: Goal, fuel?: FuelInput): CalcResult | null {
  if (!valid(trip.routeMeters, 0) || !valid(trip.speedKmh, 0) || trip.speedKmh === 0 || !valid(trip.stopSeconds, 0)) return null;
  const round = roundTripSeconds(trip);
  const carried = perTrip(load);
  if (!(round > 0) || !valid(carried, 0) || carried === 0) return null;
  const perVehicle = (carried * 60) / round;
  const stacksPerTrip = load.unit === 'm3' ? null : load.slots;
  const stacksPerVehicle = stacksPerTrip === null ? null : (stacksPerTrip * 60) / round;

  let vehicles: number;
  let utilisation: number | null = null;
  if (goal.kind === 'vehicles') {
    if (!valid(goal.targetPerMinute, 0)) return null;
    // A tiny tolerance so that 3.0000000001 vehicles (floating point) is 3, not 4.
    // Math.max: ceil of a tiny negative is -0, which would show as "-0".
    vehicles = Math.max(0, Math.ceil(goal.targetPerMinute / perVehicle - 1e-9));
    utilisation = vehicles === 0 ? 0 : goal.targetPerMinute / (vehicles * perVehicle);
  } else {
    if (!valid(goal.vehicles, 0) || !Number.isInteger(goal.vehicles)) return null;
    vehicles = goal.vehicles;
  }
  let fuelUse: CalcResult['fuel'] = null;
  if (fuel) {
    if (!valid(fuel.perMetreMJ, 0) || !valid(fuel.perTripMJ, 0) || !valid(fuel.energyMJ, 0) || fuel.energyMJ === 0) return null;
    // Items burnt per round trip, spread over the round trip.
    const items = tripEnergyMJ(trip, fuel) / fuel.energyMJ;
    const perVehicleFuel = (items * 60) / round;
    fuelUse = { perTrip: items, perVehiclePerMinute: perVehicleFuel, perMinute: vehicles * perVehicleFuel };
  }
  return {
    roundTripSeconds: round,
    perTrip: carried,
    perVehiclePerMinute: perVehicle,
    stacksPerVehiclePerMinute: stacksPerVehicle,
    vehicles,
    capacityPerMinute: vehicles * perVehicle,
    capacityStacksPerMinute: stacksPerVehicle === null ? null : vehicles * stacksPerVehicle,
    utilisation,
    fuel: fuelUse,
  };
}

/**
 * The load of a vehicle for an optional item: without an item stacks (or m³ for a fluid-only vehicle),
 * with a solid item items, with a fluid m³. null if the vehicle cannot carry it (a fluid in a truck,
 * a solid in the fluid truck).
 */
export function loadFor(vehicle: TransportVehicle, item: TransportItem | null): Load | null {
  if (item?.fluid) return vehicle.fluidCapacity !== null ? { unit: 'm3', m3: vehicle.fluidCapacity } : null;
  if (vehicle.slots === null) return item === null && vehicle.fluidCapacity !== null ? { unit: 'm3', m3: vehicle.fluidCapacity } : null;
  return item === null ? { unit: 'stacks', slots: vehicle.slots } : { unit: 'items', slots: vehicle.slots, stackSize: item.stackSize };
}

/** The fuels a vehicle takes: its own list (drone), else every fuel; empty for a vehicle without fuel use. */
export function vehicleFuels(fuels: readonly TransportFuel[], vehicle: TransportVehicle): TransportFuel[] {
  // `fuel` is missing in vehicle data built before fuel use was added.
  const use = vehicle.fuel ?? null;
  if (use === null) return [];
  if (use.fuels === null) return [...fuels];
  return use.fuels.map(o => fuels.find(f => f.id === o.id)).filter((f): f is TransportFuel => f !== undefined);
}

/** Where the default speed comes from (see `defaultSpeed`). */
export type SpeedSource = 'pathLimit' | 'traction' | 'droneFuel';

/**
 * The default of the speed input in m/s: the drone's travel speed with the given fuel; for wheeled vehicles the
 * autopilot's straight-path limit, or the speed at which the engine's tractive effort reaches 0 when that is lower
 * (the Tractor cannot reach its limit). null when the game data has neither.
 */
export function defaultSpeed(vehicle: TransportVehicle, fuelId: string | null): { mps: number; source: SpeedSource } | null {
  const options = vehicle.fuel?.fuels ?? null;
  if (options !== null) {
    const option = options.find(o => o.id === fuelId);
    return option ? { mps: option.speed, source: 'droneFuel' } : null;
  }
  const limit = vehicle.straightPathSpeed;
  const traction = vehicle.tractionSpeed ?? null;
  if (traction !== null && (limit === null || traction < limit)) return { mps: traction, source: 'traction' };
  return limit === null ? null : { mps: limit, source: 'pathLimit' };
}
