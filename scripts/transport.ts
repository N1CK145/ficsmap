import { LITRES_PER_M3, type FuelUse, type StopSource, type TransportFuel, type TransportData, type TransportVehicle, type VehicleId } from '../src/shared/transport.js';
import { byClassName, docsItems, docsNumber, type DocsClass } from './game-docs.js';

/**
 * Builds the dataset's `transport.json` (the vehicle calculator's data) from the game's Docs files
 * (`scripts/game-docs.ts`) and the extractor's `transport.json` (`--transport-out`, values only in the
 * paks). Every number comes from one of them; see "Transport" in data-src/extractor/README.md for the fields used.
 */

/** The extractor's `transport.json`: blueprint class defaults, null where no blueprint sets the value. */
export interface RawTransport {
  vehicles: {
    class: string;
    inventorySize: number | null;
    isFluidStorage: boolean | null;
    fluidStackSizeMultiplier: number | null;
    dockingSequenceDuration: number | null;
    takeoffSequenceDuration: number | null;
    straightPathSpeedLimit: number | null;
    /** Speed (m/s) at which the autopilot's tractive effort curve reaches 0. */
    tractionSpeedLimit: number | null;
    /** The drone's fuel types: item class and travel speed in cm/s. */
    droneFuelTypes: { item: string; travelSpeed: number | null }[] | null;
  }[];
}

interface VehicleDef {
  id: VehicleId;
  /** Descriptor in the Docs (name, inventory) and blueprint in the extractor output. */
  desc: string;
  blueprint: string;
  stop: StopSource | null;
  fuel: FuelUse['source'] | null;
  /** Freight cars carry either solids or one fluid. */
  fluidToo?: boolean;
}

/**
 * The vehicles that move goods automatically between stations. Not included: the Cyber Wagon and the Factory Cart,
 * 1 inventory slot each (the Factory Cart needs no fuel); the Electric Locomotive carries nothing itself.
 */
const VEHICLES: VehicleDef[] = [
  { id: 'tractor', desc: 'Desc_Tractor_C', blueprint: 'BP_Tractor_C', stop: 'truckStation', fuel: 'autopilot' },
  { id: 'truck', desc: 'Desc_Truck_C', blueprint: 'BP_Truck_C', stop: 'truckStation', fuel: 'autopilot' },
  { id: 'explorer', desc: 'Desc_Explorer_C', blueprint: 'BP_Explorer_C', stop: 'truckStation', fuel: 'autopilot' },
  { id: 'fluidTruck', desc: 'Desc_FluidTruck_C', blueprint: 'BP_FluidTruck_C', stop: 'fluidTruckStation', fuel: 'autopilot' },
  { id: 'drone', desc: 'Desc_DroneTransport_C', blueprint: 'BP_DroneTransport_C', stop: 'dronePort', fuel: 'dronePort' },
  { id: 'freightCar', desc: 'Desc_FreightWagon_C', blueprint: 'BP_FreightWagon_C', stop: 'freightPlatform', fuel: null, fluidToo: true },
];

/** Centimetres per metre: the game measures distances in cm (`mAutopilotFuelConsumption` is per cm). */
const CM_PER_M = 100;

/**
 * A display name on one line. Some names carry a manual line break for the game's UI: a hyphen at the break before
 * a lowercase letter only splits the word (German "Plutonium- \r\nbrennstab" is "Plutoniumbrennstab"); after any
 * other hyphen the break goes, elsewhere it becomes a space.
 */
export function oneLine(name: string): string {
  return name
    .replace(/-[^\S\r\n]*[\r\n]+\s*(?=\p{Ll})/gu, '')
    .replace(/-[^\S\r\n]*[\r\n]+\s*/g, '-')
    .replace(/\s*[\r\n]+\s*/g, ' ');
}

/** A "<n> m³" capacity in an English description (thousands separated by commas), or null. */
export function describedCubicMetres(description: string): number | null {
  // Also with a (narrow) no-break space before the unit, as some game texts have it.
  const m = /([\d,]+(?:\.\d+)?)\s*m³/.exec(description);
  return m ? Number(m[1]!.replaceAll(',', '')) : null;
}

export function buildTransportData(docsEn: readonly DocsClass[], docsDe: readonly DocsClass[], raw: RawTransport, gameVersion: string): TransportData {
  const en = byClassName(docsEn);
  const de = byClassName(docsDe);
  const name = (cls: string) => ({ en: oneLine(en.get(cls)?.mDisplayName ?? cls), de: oneLine(de.get(cls)?.mDisplayName ?? en.get(cls)?.mDisplayName ?? cls) });

  const itemsEn = docsItems(docsEn);
  const fluidStacks = new Set(itemsEn.filter(i => i.fluid).map(i => i.stackSize));
  if (fluidStacks.size !== 1) throw new Error(`Expected one fluid stack size, got ${[...fluidStacks].join(', ')}`);
  const fluidStackLitres = [...fluidStacks][0]!;

  // Since 1.2.0.0 a Truck Station loads or unloads a docked vehicle in one cycle of fixed length, whatever it
  // carries; its description's "120 stacks per minute" is left over from the old system and not used.
  const truckStationCycle = docsNumber(en, 'Build_TruckStation_C', 'mLoadUnloadCycleLength');
  // The Fluid Truck Station has its own cycle; that it also moves the whole load in one cycle is assumed by analogy.
  const fluidStationCycle = docsNumber(en, 'Build_FluidTruckStation_C', 'mLoadUnloadCycleLength');
  const platformLoad = docsNumber(en, 'Build_TrainDockingStation_C', 'mTimeToCompleteLoad');
  const platformUnload = docsNumber(en, 'Build_TrainDockingStation_C', 'mTimeToCompleteUnload');
  const fluidPlatform = docsNumber(en, 'Build_TrainDockingStationLiquid_C', 'mTimeToCompleteLoad') + docsNumber(en, 'Build_TrainDockingStationLiquid_C', 'mTimeToCompleteUnload');
  if (fluidPlatform !== platformLoad + platformUnload) throw new Error('Freight Platform and Fluid Freight Platform have different load/unload times');

  const items = itemsEn
    .map(i => ({ id: i.className, name: name(i.className), stackSize: i.stackSize, fluid: i.fluid }))
    .sort((a, b) => a.name.en.localeCompare(b.name.en, 'en'));
  // Wheeled vehicles take every solid item with an energy value (Leaves up to the fuel rods); fluids only packaged.
  const fuels: TransportFuel[] = itemsEn
    .filter(i => !i.fluid && i.energyMJ > 0)
    .map(i => ({ id: i.className, name: name(i.className), energyMJ: i.energyMJ }))
    .sort((a, b) => a.energyMJ - b.energyMJ || a.name.en.localeCompare(b.name.en, 'en'));

  /**
   * Wheeled vehicles on autopilot burn fuel per distance: `mAutopilotFuelConsumption` is energy "per centimeter of
   * distance travelled with autopilot enabled" (FGWheeledVehicle.h), read as MJ. The drone pays a fixed cost per round
   * trip plus a cost per metre flown (Drone Port `mTripPowerCost`, `mTripPowerPerMeterCost`, MJ as players tested it),
   * with the fuels and speeds of its blueprint.
   */
  const fuelUse = (def: VehicleDef, bp: RawTransport['vehicles'][number]): FuelUse => {
    if (def.fuel === 'autopilot') {
      return { source: 'autopilot', perMetreMJ: docsNumber(en, def.desc, 'mAutopilotFuelConsumption') * CM_PER_M, perTripMJ: 0, fuels: null };
    }
    if (!bp.droneFuelTypes?.length) throw new Error(`${def.blueprint}: no droneFuelTypes`);
    const options = bp.droneFuelTypes.map(f => {
      if (!fuels.some(x => x.id === f.item)) throw new Error(`${def.blueprint}: fuel ${f.item} is no solid fuel in the Docs`);
      if (f.travelSpeed === null) throw new Error(`${def.blueprint}: fuel ${f.item} has no travel speed`);
      return { id: f.item, speed: f.travelSpeed / CM_PER_M };
    });
    return {
      source: 'dronePort',
      perMetreMJ: docsNumber(en, 'Build_DroneStation_C', 'mTripPowerPerMeterCost'),
      perTripMJ: docsNumber(en, 'Build_DroneStation_C', 'mTripPowerCost'),
      fuels: options,
    };
  };

  // Fields added to the patch later are missing (not null) in an older extractor output.
  if (raw.vehicles.some(v => v.tractionSpeedLimit === undefined || v.droneFuelTypes === undefined)) {
    throw new Error('Extractor transport.json is from an older patch (no tractionSpeedLimit/droneFuelTypes); re-run it with --transport-out');
  }
  const vehicles: TransportVehicle[] = VEHICLES.map(def => {
    const bp = raw.vehicles.find(v => v.class === def.blueprint);
    if (!bp) throw new Error(`Extractor transport.json has no ${def.blueprint}`);
    const inventory = docsNumber(en, def.desc, 'mInventorySize');
    if (bp.inventorySize !== null && bp.inventorySize !== inventory) throw new Error(`${def.desc}: Docs inventory ${inventory}, blueprint ${bp.inventorySize}`);
    const fluidOnly = en.get(def.desc)?.mIsFluidStorageInventory === 'True';

    let fluidCapacity: number | null = null;
    if (fluidOnly || def.fluidToo) {
      if (bp.fluidStackSizeMultiplier === null) throw new Error(`${def.blueprint}: no mFluidStackSizeMultiplier`);
      // A fluid slot holds the fluid stack size times the vehicle's multiplier; a freight car holds one fluid in one slot.
      fluidCapacity = (fluidOnly ? inventory : 1) * fluidStackLitres * bp.fluidStackSizeMultiplier / LITRES_PER_M3;
      const described = describedCubicMetres(en.get(def.desc)?.mDescription ?? '');
      if (described !== null && described !== fluidCapacity) throw new Error(`${def.desc}: computed ${fluidCapacity} m³, description says ${described} m³`);
    }
    const slots = fluidOnly ? null : inventory;

    let stopSeconds: number | null = null;
    if (def.stop === 'truckStation') stopSeconds = 2 * truckStationCycle;
    else if (def.stop === 'fluidTruckStation') stopSeconds = 2 * fluidStationCycle;
    else if (def.stop === 'freightPlatform') stopSeconds = platformLoad + platformUnload;
    else if (def.stop === 'dronePort') {
      if (bp.takeoffSequenceDuration === null || bp.dockingSequenceDuration === null) throw new Error(`${def.blueprint}: no takeoff/docking duration`);
      // Docking and take-off at both ports.
      stopSeconds = 2 * (bp.dockingSequenceDuration + bp.takeoffSequenceDuration);
    }
    return {
      id: def.id, name: name(def.desc), slots, fluidCapacity, stopSeconds,
      stopSource: stopSeconds === null ? null : def.stop,
      straightPathSpeed: bp.straightPathSpeedLimit, tractionSpeed: bp.tractionSpeedLimit,
      fuel: def.fuel === null ? null : fuelUse(def, bp),
    };
  });

  return { gameVersion, vehicles, items, fuels };
}
