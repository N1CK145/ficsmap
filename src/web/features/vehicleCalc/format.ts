import {
  calculate, defaultSpeed, DEFAULT_FUEL, loadFor, vehicleFuels,
  type CalcResult, type FuelInput, type Load, type SpeedSource, type TransportData, type TransportFuel, type TransportItem,
  type TransportVehicle, type TripInput, type VehicleId,
} from '../../../shared/transport.js';
import type { CalcForm } from './useVehicleCalc.js';

/** "" or a non-number is NaN, so `calculate` rejects it. */
export const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
/** One decimal at most, for display and for the defaults put into the inputs. */
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const kmh = (mps: number) => round1(mps * 3.6);

const formats = new Map<string, Intl.NumberFormat>();
function format(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    formats.set(key, f);
  }
  return f;
}

/**
 * A fuel amount in the UI language: one decimal from 1 up ("18.5"), two significant digits below ("0.019"), and
 * "< 0.01" below that, so a nuclear fuel rod does not show as a row of zeros.
 */
export function formatFuel(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '–';
  if (value === 0 || value >= 1) return format(locale, { maximumFractionDigits: 1 }).format(value);
  if (value >= 0.01) return format(locale, { maximumSignificantDigits: 2 }).format(value);
  return `< ${format(locale, {}).format(0.01)}`;
}

/** A rate or count with one decimal at most ("22.7"), in the UI language. */
export function formatRate(value: number, locale: string): string {
  return format(locale, { maximumFractionDigits: 1 }).format(round1(value));
}

/** A duration in whole seconds: `{ s }` under a minute, else `{ m, s }`. */
export function durationParts(seconds: number): { m?: number; s: number } {
  const total = Math.max(0, Math.round(seconds));
  return total < 60 ? { s: total } : { m: Math.floor(total / 60), s: total % 60 };
}

/** The selected fuel, else Packaged Fuel, else the first; null for data without fuels. */
export function findFuel(fuels: readonly TransportFuel[] | undefined, id: string): TransportFuel | null {
  if (!fuels?.length) return null;
  return fuels.find(f => f.id === id) ?? fuels.find(f => f.id === DEFAULT_FUEL) ?? fuels[0]!;
}

export function defaultStop(v: TransportVehicle): string {
  return v.stopSeconds === null ? '' : String(round1(v.stopSeconds));
}

/** The drone flies the straight line: with a route picked on the map it takes that length, not the typed one. */
export const fliesStraight = (v: TransportVehicle) => v.id === 'drone';

/** What one vehicle runs with: the inputs in effect (typed, else the game's values) for the form. */
export interface VehicleSetup {
  /** Which form field holds its fuel: the drone keeps its own (it takes fewer fuels, its speed depends on it). */
  fuelField: 'fuel' | 'droneFuel';
  fuel: TransportFuel | null;
  speedDefault: { mps: number; source: SpeedSource } | null;
  /** The game's speed (km/h) as the input shows it; '' without one. */
  speedGame: string;
  /** The speed in effect, as typed or the game's. */
  speed: string;
  stopGame: string;
  stop: string;
  /** What it carries of the item (null: it cannot carry the item). */
  load: Load | null;
  /** The picked route's straight line (whole metres) where it is the route length instead of the typed one (the drone); else null. */
  straightLine: number | null;
  trip: TripInput;
  fuelInput?: FuelInput;
}

/**
 * One vehicle with the form's inputs in effect. `straightLine`, the picked route's straight line in whole metres (null
 * without a picked route), is the drone's route length; wheeled vehicles and the freight car take the typed one.
 */
export function vehicleSetup(
  vehicle: TransportVehicle, data: TransportData, form: CalcForm, item: TransportItem | null, straightLine: number | null = null,
): VehicleSetup {
  const fuelField = vehicle.fuel?.fuels ? 'droneFuel' : 'fuel';
  const fuel = vehicle.fuel ? findFuel(vehicleFuels(data.fuels ?? [], vehicle), form[fuelField]) : null;
  const speedDefault = defaultSpeed(vehicle, fuel?.id ?? null);
  const speedGame = speedDefault ? String(kmh(speedDefault.mps)) : '';
  const speed = form.speed[vehicle.id] ?? speedGame;
  const stopGame = defaultStop(vehicle);
  const stop = form.stop[vehicle.id] ?? stopGame;
  const straight = straightLine !== null && fliesStraight(vehicle) ? straightLine : null;
  const setup: VehicleSetup = {
    fuelField, fuel, speedDefault, speedGame, speed, stopGame, stop,
    load: loadFor(vehicle, item),
    straightLine: straight,
    trip: { routeMeters: straight ?? num(form.route), speedKmh: num(speed), stopSeconds: num(stop) },
  };
  if (fuel && vehicle.fuel) setup.fuelInput = { perMetreMJ: vehicle.fuel.perMetreMJ, perTripMJ: vehicle.fuel.perTripMJ, energyMJ: fuel.energyMJ };
  return setup;
}

/** The straight line (m) the vehicle flies in place of a different typed length (the drone on a picked route), else null. */
export function straightInstead(setup: VehicleSetup, form: CalcForm): number | null {
  return setup.straightLine !== null && setup.straightLine !== num(form.route) ? setup.straightLine : null;
}

/** One vehicle of the setup on the route; null while the input is incomplete or it cannot carry the item. */
export function oneVehicle(setup: VehicleSetup): CalcResult | null {
  return setup.load ? calculate(setup.trip, setup.load, { kind: 'rate', vehicles: 1 }, setup.fuelInput) : null;
}

/** The main figure of one vehicle: stacks per minute, or m³ per minute for a fluid load. */
export interface CardRate {
  value: number; unit: 'stacks' | 'm3';
  /** The straight line (m) it flies when that is not the typed length (the drone on a picked route). */
  straightLine?: number;
}

/** A vehicle card's figure: whole numbers from 100 up ("1,389"), one decimal below ("21.1"). */
export const cardValue = (n: number) => (n >= 100 ? Math.round(n) : round1(n));

/**
 * Every vehicle on the route with its own inputs in effect (speed, stop time and, for the drone, fuel and the picked
 * route's straight line, see `vehicleSetup`), so the vehicle cards compare them: stacks (or m³) per minute. A vehicle
 * without a route length above 0 or without a result (no speed, cannot carry the item) is missing.
 */
export function cardRates(data: TransportData, form: CalcForm, item: TransportItem | null, straightLine: number | null = null): Map<VehicleId, CardRate> {
  const out = new Map<VehicleId, CardRate>();
  for (const v of data.vehicles) {
    const setup = vehicleSetup(v, data, form, item, straightLine);
    if (!(setup.trip.routeMeters > 0)) continue;
    const r = oneVehicle(setup);
    if (!r || !setup.load) continue;
    const rate: CardRate = setup.load.unit === 'm3'
      ? { value: r.perVehiclePerMinute, unit: 'm3' }
      : { value: r.stacksPerVehiclePerMinute ?? 0, unit: 'stacks' };
    const straight = straightInstead(setup, form);
    if (straight !== null) rate.straightLine = straight;
    out.set(v.id, rate);
  }
  return out;
}
